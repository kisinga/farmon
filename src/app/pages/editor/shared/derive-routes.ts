/**
 * Thin delegation layer — re-exports from @core so existing
 * import paths (from '../shared/derive-routes') continue to work.
 */

import { buildGraph, deriveRoutes as _deriveRoutes, type Route, type TopologyNode, type PipeSegment } from '@core';

export type DerivedRoute = Route;

export { type Route } from '@core';

export function deriveRoutes(topology: { nodes: TopologyNode[]; pipes: PipeSegment[] }): DerivedRoute[] {
  const graph = buildGraph(topology.nodes, topology.pipes);
  return _deriveRoutes(graph);
}

// Re-export highlighting functions
export {
  pipesFromSource as findPipesFromSource,
  pipesToDestination as findPipesToDestination,
  connectedPipes as findConnectedPipes,
} from '@core';

// Re-export graph functions for consumers that work with TopologyGraph directly
export { buildGraph, activeGraph } from '@core';
export type { TopologyGraph } from '@core';
