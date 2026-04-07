import type { Topology, TopologyNode, PipeSegment } from "../topology.js";
import { parsePortRef } from "../topology.js";

/**
 * A route with full ordered node sequence preserved.
 * Used by topology rules that need to reason about entity order
 * (e.g., valve must come before flow sensor on pump outlet side).
 */
export interface RouteSequence {
  source: string;
  sourceKind: string;
  destination: string;
  destKind: string;
  /** Ordered list of node IDs from source to destination (inclusive). */
  nodeSequence: string[];
  crossesPump: boolean;
  /** Index of the pump in nodeSequence (-1 if no pump). */
  pumpIndex: number;
}

/** Build adjacency: nodeId -> outgoing pipes from that node. */
function buildAdjacency(pipes: PipeSegment[]): Map<string, PipeSegment[]> {
  const adj = new Map<string, PipeSegment[]>();
  for (const pipe of pipes) {
    const { nodeId } = parsePortRef(pipe.from);
    const list = adj.get(nodeId) ?? [];
    list.push(pipe);
    adj.set(nodeId, list);
  }
  return adj;
}

const TERMINAL_KINDS = new Set(["tank", "endpoint", "water_source"]);

function traceSequences(
  sourceId: string,
  sourceKind: string,
  adj: Map<string, PipeSegment[]>,
  nodes: Map<string, TopologyNode>,
): RouteSequence[] {
  const results: RouteSequence[] = [];

  interface BfsEntry {
    nodeId: string;
    sequence: string[];
    pumpIndex: number;
  }

  const queue: BfsEntry[] = [{
    nodeId: sourceId,
    sequence: [sourceId],
    pumpIndex: -1,
  }];

  while (queue.length > 0) {
    const entry = queue.shift()!;
    const outPipes = adj.get(entry.nodeId) ?? [];

    for (const pipe of outPipes) {
      const { nodeId: targetId } = parsePortRef(pipe.to);
      // Prevent cycles
      if (entry.sequence.includes(targetId)) continue;

      const target = nodes.get(targetId);
      if (!target) continue;
      if ((target as any).disabled) continue;

      const nextSequence = [...entry.sequence, targetId];
      const nextPumpIndex = target.kind === "pump"
        ? nextSequence.length - 1
        : entry.pumpIndex;

      if (TERMINAL_KINDS.has(target.kind)) {
        results.push({
          source: sourceId,
          sourceKind,
          destination: target.id,
          destKind: target.kind,
          nodeSequence: nextSequence,
          crossesPump: nextPumpIndex >= 0,
          pumpIndex: nextPumpIndex,
        });
      } else {
        queue.push({
          nodeId: targetId,
          sequence: nextSequence,
          pumpIndex: nextPumpIndex,
        });
      }
    }
  }

  return results;
}

/**
 * Derive all route sequences from the topology.
 * Returns ordered node sequences for each route, including pump position.
 */
export function deriveRouteSequences(topology: Topology): RouteSequence[] {
  const nodes = new Map(topology.nodes.map((n) => [n.id, n]));
  const adj = buildAdjacency(topology.pipes);
  const results: RouteSequence[] = [];

  for (const node of topology.nodes) {
    if ((node as any).disabled) continue;
    if (node.kind === "tank" || node.kind === "water_source") {
      results.push(...traceSequences(node.id, node.kind, adj, nodes));
    }
  }

  return results;
}
