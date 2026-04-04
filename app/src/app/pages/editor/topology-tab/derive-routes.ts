/**
 * Pure BFS route derivation.
 * Uses entity registry roles for node classification instead of hardcoded kind checks.
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

function buildAdjacency(pipes: PipeSegment[]): Map<string, PipeSegment[]> {
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

      // Domain semantics: valves define routes, flow sensors confirm flow
      const pipeValves = pipe.components
        .filter((c) => c.kind === 'valve')
        .map((c) => c.id);
      const pipeFlow = pipe.components.find((c) => c.kind === 'flow_sensor');

      const nextValves = [...entry.valves, ...pipeValves];
      const nextFlow = pipeFlow ? pipeFlow.id : entry.flowSensor;
      const nextPump = entry.crossesPump || targetRole === 'passthrough';
      const nextVisited = new Set(entry.visited);
      nextVisited.add(targetId);

      if (targetRole === 'terminal') {
        const key = `${sourceId}>${target.id}`;
        const valid = nextPump && !!nextFlow && nextValves.length > 0;
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
