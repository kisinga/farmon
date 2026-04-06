/**
 * Pure BFS route derivation.
 * Traverses the node-pipe graph collecting valves and flow sensors along each path.
 */
import type { SystemTopology, TopologyNode, PipeSegment } from '../../../core/models/topology.model';
import { NODE_REGISTRY } from '../../../core/models/entities.model';

export interface DerivedRoute {
  key: string;
  source: string;
  destination: string;
  destKind: string;
  valves: string[];
  flowSensor?: string;
  crossesPump: boolean;
  valid: boolean;
}

/** Build adjacency: nodeId → outgoing pipes */
export function buildAdjacency(pipes: PipeSegment[]): Map<string, PipeSegment[]> {
  const adj = new Map<string, PipeSegment[]>();
  for (const pipe of pipes) {
    const nodeId = pipe.from.split(':')[0];
    const list = adj.get(nodeId) ?? [];
    list.push(pipe);
    adj.set(nodeId, list);
  }
  return adj;
}

interface BfsEntry {
  nodeId: string;
  valves: string[];
  flowSensor: string | undefined;
  crossesPump: boolean;
  visited: Set<string>;
}

function traceRoutes(
  sourceId: string,
  adj: Map<string, PipeSegment[]>,
  nodes: Map<string, TopologyNode>,
): DerivedRoute[] {
  const results: DerivedRoute[] = [];

  const queue: BfsEntry[] = [{
    nodeId: sourceId,
    valves: [],
    flowSensor: undefined,
    crossesPump: false,
    visited: new Set([sourceId]),
  }];

  while (queue.length > 0) {
    const entry = queue.shift()!;
    const outPipes = adj.get(entry.nodeId) ?? [];

    for (const pipe of outPipes) {
      const targetId = pipe.to.split(':')[0];
      if (entry.visited.has(targetId)) continue;

      const target = nodes.get(targetId);
      if (!target) continue;

      const targetDesc = NODE_REGISTRY.get(target.kind);
      const targetRole = targetDesc?.role;

      // Collect valves and flow sensors from the TARGET node
      const nextValves = [...entry.valves];
      let nextFlow = entry.flowSensor;
      if (target.kind === 'valve') nextValves.push(target.id);
      if (target.kind === 'flow_sensor') nextFlow = target.id;

      const nextPump = entry.crossesPump || target.kind === 'pump';
      const nextVisited = new Set(entry.visited);
      nextVisited.add(targetId);

      if (targetRole === 'terminal') {
        const key = `${sourceId}>${target.id}`;
        const valid = !!nextFlow && nextValves.length > 0;
        results.push({
          key,
          source: sourceId,
          destination: target.id,
          destKind: target.kind,
          valves: nextValves,
          flowSensor: nextFlow,
          crossesPump: nextPump,
          valid,
        });
      } else {
        queue.push({
          nodeId: targetId,
          valves: nextValves,
          flowSensor: nextFlow,
          crossesPump: nextPump,
          visited: nextVisited,
        });
      }
    }
  }

  return results;
}

export function deriveRoutes(topology: SystemTopology): DerivedRoute[] {
  const nodes = new Map(topology.nodes.map((n) => [n.id, n]));
  const adj = buildAdjacency(topology.pipes);
  const routes: DerivedRoute[] = [];

  for (const node of topology.nodes) {
    const desc = NODE_REGISTRY.get(node.kind);
    if (desc?.routeSource) {
      routes.push(...traceRoutes(node.id, adj, nodes));
    }
  }

  return routes;
}

/**
 * Given a pipe, find all pipe IDs that belong to the same connected route(s).
 * Traces forward and backward from the pipe's endpoints, stopping at terminal nodes.
 */
export function findConnectedPipes(pipeId: string, topology: SystemTopology): string[] {
  const pipe = topology.pipes.find(p => p.id === pipeId);
  if (!pipe) return [];

  const nodes = new Map(topology.nodes.map(n => [n.id, n]));

  // Build bidirectional adjacency: nodeId → pipes (both directions)
  const fwd = new Map<string, PipeSegment[]>();  // outgoing
  const rev = new Map<string, PipeSegment[]>();  // incoming
  for (const p of topology.pipes) {
    const fromNode = p.from.split(':')[0];
    const toNode = p.to.split(':')[0];
    fwd.set(fromNode, [...(fwd.get(fromNode) ?? []), p]);
    rev.set(toNode, [...(rev.get(toNode) ?? []), p]);
  }

  const collected = new Set<string>();

  const isTerminal = (nodeId: string) => {
    const node = nodes.get(nodeId);
    if (!node) return true;
    const desc = NODE_REGISTRY.get(node.kind);
    return desc?.role === 'terminal';
  };

  // Trace forward from the pipe's target node
  const traceForward = (startNodeId: string, visited: Set<string>) => {
    if (visited.has(startNodeId)) return;
    visited.add(startNodeId);
    for (const p of fwd.get(startNodeId) ?? []) {
      collected.add(p.id);
      const nextNode = p.to.split(':')[0];
      if (!isTerminal(nextNode)) traceForward(nextNode, visited);
    }
  };

  // Trace backward from the pipe's source node
  const traceBackward = (startNodeId: string, visited: Set<string>) => {
    if (visited.has(startNodeId)) return;
    visited.add(startNodeId);
    for (const p of rev.get(startNodeId) ?? []) {
      collected.add(p.id);
      const prevNode = p.from.split(':')[0];
      if (!isTerminal(prevNode)) traceBackward(prevNode, visited);
    }
  };

  collected.add(pipeId);
  const fromNode = pipe.from.split(':')[0];
  const toNode = pipe.to.split(':')[0];

  // Trace backward from source node (unless it's terminal)
  if (!isTerminal(fromNode)) {
    traceBackward(fromNode, new Set());
  }
  // Trace forward from target node (unless it's terminal)
  if (!isTerminal(toNode)) {
    traceForward(toNode, new Set());
  }
  // Also trace forward from source and backward from target to get the full route
  traceForward(fromNode, new Set());
  traceBackward(toNode, new Set());

  return [...collected];
}
