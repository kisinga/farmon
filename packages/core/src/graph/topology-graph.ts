/**
 * Graph substrate — the single entry point for building a graphology
 * directed graph from a flat topology (nodes[] + pipes[]).
 *
 * Replaces all hand-rolled buildAdjacency() copies.
 */
import Graph from 'graphology';
import type { TopologyNode, PipeSegment } from '../topology.types';
import { NODE_REGISTRY } from '../entity-registry';

// ── Node & edge attribute types ─────────────────────────────────────────────

export interface NodeAttrs {
  kind: string;
  role: 'terminal' | 'passthrough';
  routeSource: boolean;
  data: TopologyNode;
}

export interface EdgeAttrs {
  pipeId: string;
  fromPort: string;
  toPort: string;
}

export type TopologyGraph = Graph<NodeAttrs, EdgeAttrs>;

// ── Graph construction ──────────────────────────────────────────────────────

export function buildGraph(nodes: TopologyNode[], pipes: PipeSegment[]): TopologyGraph {
  const g: TopologyGraph = new Graph({ type: 'directed', multi: false });

  for (const node of nodes) {
    const desc = NODE_REGISTRY.get(node.kind);
    g.addNode(node.id, {
      kind: node.kind,
      role: desc?.role ?? 'passthrough',
      routeSource: desc?.routeSource ?? false,
      data: node,
    });
  }

  for (const pipe of pipes) {
    const [fromNode, fromPort] = pipe.from.split(':');
    const [toNode, toPort] = pipe.to.split(':');
    if (g.hasNode(fromNode) && g.hasNode(toNode)) {
      g.addEdge(fromNode, toNode, {
        pipeId: pipe.id,
        fromPort,
        toPort,
      });
    }
  }

  return g;
}
