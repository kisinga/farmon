/**
 * Thin delegation layer — re-exports from shared/graph/ so existing
 * import paths (from '../shared/derive-routes') continue to work.
 */
import type { SystemTopology } from '../../../core/models/topology.model';
import { buildGraph, activeGraph, deriveRoutes as _deriveRoutes, type Route } from '../../../../../shared/graph/index';

export type DerivedRoute = Route;

export { type Route } from '../../../../../shared/graph/index';

export function deriveRoutes(topology: SystemTopology): DerivedRoute[] {
  const graph = buildGraph(topology.nodes, topology.pipes);
  return _deriveRoutes(graph);
}

// Re-export highlighting functions that accept SystemTopology
// (builds the graph internally for convenience)
export {
  pipesFromSource as findPipesFromSource,
  pipesToDestination as findPipesToDestination,
  connectedPipes as findConnectedPipes,
} from '../../../../../shared/graph/index';

// Re-export buildGraph + graph-based functions for consumers that work with TopologyGraph directly
export { buildGraph, activeGraph } from '../../../../../shared/graph/index';
export type { TopologyGraph } from '../../../../../shared/graph/index';
