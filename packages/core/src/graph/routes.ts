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
import type { TopologyNode } from '../topology.types';

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
  /** ALL flow sensor IDs along the path, in flow order. */
  flowSensors: string[];
  /** True if route crosses a pump. */
  crossesPump: boolean;
  /** Index of pump in nodeSequence (-1 if none). */
  pumpIndex: number;
  /** True if route has at least one flow sensor. */
  valid: boolean;
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
    crossesPump: pumpIndex >= 0,
    pumpIndex,
    valid: flowSensors.length > 0,
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
  const terminals = graph.filterNodes((_id, attrs) => attrs.role === 'terminal');

  const routes: Route[] = [];

  for (const sourceId of sources) {
    for (const sinkId of terminals) {
      if (sourceId === sinkId) continue;
      const paths = allSimplePaths(graph, sourceId, sinkId);
      for (const path of paths) {
        routes.push(analyzePathSequence(graph, path));
      }
    }
  }

  return routes;
}
