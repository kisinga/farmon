/**
 * Active-node filtering — single source of truth for "what does disabled mean."
 * Edges touching disabled nodes are automatically dropped by subgraph().
 */
import { subgraph } from 'graphology-operators';
import type { TopologyGraph } from './topology-graph';

/** Single predicate for whether a node is active (not disabled). */
export const isNodeActive = (n: { disabled?: boolean }): boolean => !n.disabled;

export function activeGraph(g: TopologyGraph): TopologyGraph {
  return subgraph(g, (_nodeId, attrs) => isNodeActive(attrs.data));
}
