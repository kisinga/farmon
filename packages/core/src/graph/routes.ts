/**
 * Unified route derivation.
 *
 * Replaces:
 *   - src/app/pages/editor/shared/derive-routes.ts  (DerivedRoute + BFS)
 *   - electron/lib/rules/trace-route-sequence.ts     (RouteSequence + BFS)
 *   - electron/lib/topology-to-manifest.ts           (TracedRoute + BFS)
 *
 * Uses graphology's allSimplePaths for cycle-free path enumeration.
 */
import { allSimplePaths } from 'graphology-simple-path';
import type { TopologyGraph } from './topology-graph';
import type { TopologyNode, SiteTopology } from '../topology.types';

// ── Unified Route ───────────────────────────────────────────────────────────

export interface Route {
  /**
   * Stable key uniquely identifying a path between two endpoints.
   *
   * Format: `"<sourceId>><destId>#<valveA>+<valveB>+..."` where valve ids are
   * sorted lexicographically. The suffix disambiguates parallel paths between
   * the same endpoints — by topology invariant, parallel routes never share
   * the same valve set.
   *
   * Routes with zero valves omit the `#` suffix entirely.
   */
  key: string;
  source: string;
  sourceKind: TopologyNode['kind'];
  destination: string;
  destKind: TopologyNode['kind'];
  /** Ordered node IDs from source to destination (inclusive). */
  nodeSequence: string[];
  /** Valve IDs encountered along the path, in flow order. */
  valves: string[];
  /** ALL flow sensor IDs along the path, in flow order. May be empty for unmonitored segments. */
  flowSensors: string[];
  /** True if route has at least one flow sensor (monitored segment). */
  monitored: boolean;
  /** True if route crosses a pump. */
  crossesPump: boolean;
  /** Index of pump in nodeSequence (-1 if none). */
  pumpIndex: number;
}

// ── Route derivation ────────────────────────────────────────────────────────

function analyzePathSequence(graph: TopologyGraph, path: string[]): Route {
  const valves: string[] = [];
  const flowSensors: string[] = [];
  let pumpIndex = -1;

  for (let i = 0; i < path.length; i++) {
    const attrs = graph.getNodeAttributes(path[i]);
    if (attrs.isValve) valves.push(path[i]);
    if (attrs.isFlowSensor) flowSensors.push(path[i]);
    if (attrs.isPump && pumpIndex === -1) pumpIndex = i;
  }

  const source = path[0];
  const destination = path[path.length - 1];
  const suffix = valves.length ? `#${[...valves].sort().join('+')}` : '';

  return {
    key: `${source}>${destination}${suffix}`,
    source,
    sourceKind: graph.getNodeAttribute(source, 'kind'),
    destination,
    destKind: graph.getNodeAttribute(destination, 'kind'),
    nodeSequence: path,
    valves,
    flowSensors,
    monitored: flowSensors.length > 0,
    crossesPump: pumpIndex >= 0,
    pumpIndex,
  };
}

/**
 * Parse a Route.key into its component parts.
 *
 * Accepts both new format (`src>dst#valveA+valveB`) and legacy bare format
 * (`src>dst`). Suffix may be empty.
 */
export function parseRouteKey(key: string): { source: string; destination: string; valves: string[] } {
  const [endpoints, suffix] = key.split('#', 2);
  const [source, destination] = endpoints.split('>', 2);
  const valves = suffix ? suffix.split('+').filter(Boolean) : [];
  return { source, destination, valves };
}

export function deriveRoutes(graph: TopologyGraph): Route[] {
  const sources = graph.filterNodes((_id, attrs) => attrs.routeSource);
  const waypoints = graph.filterNodes((_id, attrs) => attrs.role === 'terminal');

  const routes: Route[] = [];

  for (const sourceId of sources) {
    for (const destId of waypoints) {
      if (sourceId === destId) continue;
      const paths = allSimplePaths(graph, sourceId, destId);
      for (const path of paths) {
        // A segment must not pass through an intermediate waypoint.
        // Waypoints are natural boundaries (tanks buffer water; you fill,
        // then you drain). Paths that pass through an intermediate waypoint
        // are compositions of multiple segments and are handled separately.
        const hasIntermediateWaypoint = path.slice(1, -1).some(
          nodeId => graph.getNodeAttribute(nodeId, 'role') === 'terminal'
        );
        if (hasIntermediateWaypoint) continue;

        // Count pumps in the path. The firmware supports at most one pump
        // per segment. In well-structured topologies, intermediate tanks
        // naturally prevent multi-pump segments; this is a safety guardrail.
        const pumpCount = path.filter(
          nodeId => graph.getNodeAttribute(nodeId, 'isPump')
        ).length;
        if (pumpCount > 1) {
          console.warn(
            `[deriveRoutes] Path ${path.join(' -> ')} crosses ${pumpCount} pumps.` +
            ` Multi-pump paths must pass through an intermediate tank. Segment rejected.`
          );
          continue;
        }

        routes.push(analyzePathSequence(graph, path));
      }
    }
  }

  return routes;
}

/**
 * Determine whether a controller can claim a segment.
 *
 * A controller claims a segment if:
 *   1. It can access all actuators (pumps, valves) in the segment.
 *   2. Monitored segments: at least one flow sensor is local.
 *   3. Unmonitored segments: the destination is local (for level-based stopping).
 */
export function controllerClaimsSegment(
  route: Route,
  controllerId: string,
  topology: SiteTopology,
): boolean {
  const claimedNodeIds = new Set(
    topology.remoteImports
      .filter(c => c.controllerId === controllerId)
      .map(c => c.nodeId),
  );

  const canAccessActuator = (nodeId: string) => {
    const node = topology.nodes.find(n => n.id === nodeId);
    if (!node) return false;
    if (node.anchorId === controllerId) return true;
    if (claimedNodeIds.has(nodeId)) return true;
    return false;
  };

  // Every actuator must be accessible
  for (const nodeId of route.nodeSequence) {
    const node = topology.nodes.find(n => n.id === nodeId);
    if (!node) return false;
    if ((node.kind === 'pump' || node.kind === 'valve') && !canAccessActuator(nodeId)) {
      return false;
    }
  }

  // Monitored segments need a local flow sensor
  if (route.flowSensors.length > 0) {
    const hasLocalFlow = route.flowSensors.some(id => {
      const node = topology.nodes.find(n => n.id === id);
      return node && node.anchorId === controllerId;
    });
    if (!hasLocalFlow) return false;
  }

  // Unmonitored segments need a local destination (for level-based stopping)
  if (route.flowSensors.length === 0 && route.destination) {
    const destNode = topology.nodes.find(n => n.id === route.destination);
    if (!destNode || destNode.anchorId !== controllerId) return false;
  }

  return true;
}
