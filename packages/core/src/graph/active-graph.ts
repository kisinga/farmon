/**
 * Filter a topology graph to only active (non-disabled) nodes.
 * Edges touching disabled nodes are automatically dropped by subgraph().
 *
 * Replaces shared/active-topology.ts.
 */
import { subgraph } from 'graphology-operators';
import type { TopologyGraph } from './topology-graph';

export function activeGraph(g: TopologyGraph): TopologyGraph {
  return subgraph(g, (_nodeId, attrs) => !attrs.data.disabled);
}
