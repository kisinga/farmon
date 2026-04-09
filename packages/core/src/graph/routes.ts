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

// ── Unified Route ───────────────────────────────────────────────────────────

export interface Route {
  /** Stable key: "sourceId>destId" */
  key: string;
  source: string;
  sourceKind: string;
  destination: string;
  destKind: string;
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
    const kind = graph.getNodeAttribute(path[i], 'kind');
    if (kind === 'valve') valves.push(path[i]);
    if (kind === 'flow_sensor') flowSensors.push(path[i]);
    if ((kind === 'pump' || kind === 'dosing_pump') && pumpIndex === -1) pumpIndex = i;
  }

  const source = path[0];
  const destination = path[path.length - 1];

  return {
    key: `${source}>${destination}`,
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
