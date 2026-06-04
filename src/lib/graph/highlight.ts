/**
 * Canvas highlighting operations using graphology traversal.
 *
 * Replaces findPipesFromSource, findPipesToDestination,
 * findConnectedPipes from derive-routes.ts, and collectDownstream
 * from topology-x6-tab.component.ts.
 */
import { bfsFromNode } from 'graphology-traversal';
import Graph from 'graphology';
import type { TopologyGraph, NodeAttrs, EdgeAttrs } from './topology-graph';

/**
 * BFS forward from a source node. Collect pipe IDs of all traversed edges.
 * Stops traversal at terminal nodes (does not traverse past them).
 */
export function pipesFromSource(graph: TopologyGraph, sourceId: string): string[] {
  if (!graph.hasNode(sourceId)) return [];
  const pipeIds: string[] = [];
  const visited = new Set<string>();

  bfsFromNode(graph, sourceId, (nodeId, _attrs, depth): boolean => {
    if (visited.has(nodeId)) return true;
    visited.add(nodeId);

    graph.forEachOutEdge(nodeId, (_edge, attrs) => {
      pipeIds.push(attrs.pipeId);
    });

    // Stop at terminals (but still collect their incoming edges above)
    if (depth > 0 && graph.getNodeAttribute(nodeId, 'role') === 'terminal') {
      return true;
    }
    return false;
  });

  return pipeIds;
}

/**
 * BFS backward from a destination node on a reversed graph.
 * Collect pipe IDs of all traversed edges.
 * Stops at terminal nodes.
 */
export function pipesToDestination(graph: TopologyGraph, destId: string): string[] {
  if (!graph.hasNode(destId)) return [];

  // Build reversed graph
  const rev = new Graph<NodeAttrs, EdgeAttrs>({ type: 'directed', multi: false });
  graph.forEachNode((id, attrs) => rev.addNode(id, attrs));
  graph.forEachEdge((_edge, attrs, source, target) => {
    rev.addEdge(target, source, attrs);
  });

  const pipeIds: string[] = [];
  const visited = new Set<string>();

  bfsFromNode(rev, destId, (nodeId, _attrs, depth): boolean => {
    if (visited.has(nodeId)) return true;
    visited.add(nodeId);

    rev.forEachOutEdge(nodeId, (_edge, attrs) => {
      pipeIds.push(attrs.pipeId);
    });

    if (depth > 0 && rev.getNodeAttribute(nodeId, 'role') === 'terminal') {
      return true;
    }
    return false;
  });

  return pipeIds;
}

/**
 * Given a pipe ID, find all pipe IDs in the same connected route(s).
 * Traces bidirectionally from the pipe's endpoints, stopping at terminals.
 */
export function connectedPipes(graph: TopologyGraph, pipeId: string): string[] {
  // Find the edge with this pipeId
  let fromNode: string | null = null;
  let toNode: string | null = null;

  graph.forEachEdge((_edge, attrs, source, target) => {
    if (attrs.pipeId === pipeId) {
      fromNode = source;
      toNode = target;
    }
  });

  if (!fromNode || !toNode) return [];

  const forward = new Set(pipesFromSource(graph, fromNode));
  const backward = new Set(pipesToDestination(graph, toNode));

  // Also trace from the other direction
  const forward2 = new Set(pipesFromSource(graph, toNode));
  const backward2 = new Set(pipesToDestination(graph, fromNode));

  const all = new Set([...forward, ...backward, ...forward2, ...backward2, pipeId]);
  return [...all];
}

/**
 * BFS forward from a start node. Returns all reachable downstream node IDs.
 * Does not stop at terminals — collects everything reachable.
 */
export function downstreamNodes(graph: TopologyGraph, startId: string): string[] {
  if (!graph.hasNode(startId)) return [];
  const result: string[] = [];

  bfsFromNode(graph, startId, (nodeId, _attrs, depth) => {
    if (depth > 0) result.push(nodeId);
  });

  return result;
}
