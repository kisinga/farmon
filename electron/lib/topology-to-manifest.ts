import type { Manifest, ManifestNode, Route } from "./schema.js";
import type { Topology, TopologyNode, PipeSegment } from "./topology.js";
import { parsePortRef } from "./topology.js";

// ---------------------------------------------------------------------------
// Graph helpers
// ---------------------------------------------------------------------------

/** Build adjacency: nodeId → outgoing pipes from that node. */
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

interface TracedRoute {
  source: string;
  sourceKind: "tank" | "water_source";
  destNodeId: string;
  destKind: "tank" | "endpoint" | "water_source";
  valves: string[];
  flowSensor: string | undefined;
  crossesPump: boolean;
}

/**
 * BFS from a source through the node-pipe graph to all reachable
 * terminal nodes. Collects valves, flow sensors, and pump crossings.
 */
function traceRoutes(
  sourceId: string,
  sourceKind: "tank" | "water_source",
  adj: Map<string, PipeSegment[]>,
  nodes: Map<string, TopologyNode>,
): TracedRoute[] {
  const results: TracedRoute[] = [];

  interface BfsEntry {
    nodeId: string;
    valves: string[];
    flowSensor: string | undefined;
    crossesPump: boolean;
    visited: Set<string>;
  }

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
      const { nodeId: targetId } = parsePortRef(pipe.to);
      if (entry.visited.has(targetId)) continue;

      const target = nodes.get(targetId);
      if (!target) continue;
      const nextValves = [...entry.valves];
      let nextFlow = entry.flowSensor;
      if (target.kind === "valve") nextValves.push(target.id);
      if (target.kind === "flow_sensor") nextFlow = target.id;

      const nextPump = entry.crossesPump || target.kind === "pump";
      const nextVisited = new Set(entry.visited);
      nextVisited.add(targetId);

      if (target.kind === "tank" || target.kind === "endpoint" || target.kind === "water_source") {
        results.push({
          source: sourceId,
          sourceKind,
          destNodeId: target.id,
          destKind: target.kind,
          valves: nextValves,
          flowSensor: nextFlow,
          crossesPump: nextPump,
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

// ---------------------------------------------------------------------------
// Main conversion
// ---------------------------------------------------------------------------

export function topologyToManifest(topology: Topology): Manifest {
  const nodeMap = new Map(topology.nodes.map((n) => [n.id, n]));
  const adj = buildAdjacency(topology.pipes);

  // Only nodes connected via pipes enter the manifest.
  const connected = new Set<string>();
  for (const pipe of topology.pipes) {
    connected.add(parsePortRef(pipe.from).nodeId);
    connected.add(parsePortRef(pipe.to).nodeId);
  }

  // Strip layout fields (ports, position) — generators don't need them.
  const nodes: ManifestNode[] = topology.nodes
    .filter(n => connected.has(n.id))
    .map(({ ports, position, ...data }) => data as ManifestNode);

  // --- Route derivation ---

  const routes: Route[] = [];

  const routeSources = topology.nodes.filter(
    (n): n is Extract<TopologyNode, { kind: "tank" }> | Extract<TopologyNode, { kind: "water_source" }> =>
      (n.kind === "tank" || n.kind === "water_source") && connected.has(n.id),
  );

  for (const src of routeSources) {
    const traced = traceRoutes(src.id, src.kind as "tank" | "water_source", adj, nodeMap);

    for (const tr of traced) {
      if (!tr.flowSensor) continue;

      const overrideKey = `${tr.source}>${tr.destNodeId}`;
      const override = topology.route_overrides[overrideKey] ?? {};

      // Route name derived from node names (e.g. "Rain Tank > Roof Tank")
      const srcNode = nodeMap.get(tr.source);
      const dstNode = nodeMap.get(tr.destNodeId);
      const srcLabel = (srcNode as any)?.name ?? tr.source;
      const dstLabel = (dstNode as any)?.name ?? tr.destNodeId;

      routes.push({
        key: overrideKey,
        name: `${srcLabel} > ${dstLabel}`,
        source: tr.source,
        source_type: tr.sourceKind,
        destination: tr.destKind === "tank" ? tr.destNodeId : undefined,
        valves: tr.valves,
        flow_sensor: tr.flowSensor,
        max_runtime_seconds: override.max_runtime_seconds ?? 1800,
        needs_pump: tr.crossesPump,
      });
    }
  }

  return {
    device: { ...topology.device },
    nodes,
    routes,
    timing: { ...topology.timing },
  };
}
