import type { Manifest } from "./schema.js";
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
 * BFS from a source tank through the node-pipe graph to all reachable
 * terminal nodes. Collects valves, flow sensors, and pump crossings
 * from the nodes traversed along the path.
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

      // Collect valves and flow sensors from the target node
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
  const nodes = new Map(topology.nodes.map((n) => [n.id, n]));
  const adj = buildAdjacency(topology.pipes);

  // --- Flat node extraction ---

  const tanks = topology.nodes
    .filter((n): n is Extract<TopologyNode, { kind: "tank" }> => n.kind === "tank")
    .map((t) => ({ name: t.name, id: t.id, level_pin: t.level_pin }));

  const waterSources = topology.nodes
    .filter((n): n is Extract<TopologyNode, { kind: "water_source" }> => n.kind === "water_source")
    .map((ws) => ({ name: ws.name, id: ws.id, pressure_pin: ws.pressure_pin }));

  const pump = topology.nodes.find((n) => n.kind === "pump");
  if (!pump || pump.kind !== "pump") {
    throw new Error("Topology must contain exactly one pump node");
  }

  const valves: Manifest["valves"] = topology.nodes
    .filter((n): n is Extract<TopologyNode, { kind: "valve" }> => n.kind === "valve")
    .map((v) => ({ name: v.name, id: v.id, open_pin: v.open_pin, close_pin: v.close_pin }));

  const flowSensors: Manifest["flow_sensors"] = topology.nodes
    .filter((n): n is Extract<TopologyNode, { kind: "flow_sensor" }> => n.kind === "flow_sensor")
    .map((f) => ({ name: f.name, id: f.id, pin: f.pin, flow_cal: f.flow_cal }));

  // --- Route derivation ---

  const routes: Manifest["routes"] = [];

  // Trace from all route sources (tanks and water sources)
  const routeSources: Array<{ id: string; kind: "tank" | "water_source" }> = [
    ...tanks.map((t) => ({ id: t.id, kind: "tank" as const })),
    ...waterSources.map((ws) => ({ id: ws.id, kind: "water_source" as const })),
  ];

  for (const src of routeSources) {
    const traced = traceRoutes(src.id, src.kind, adj, nodes);

    for (const tr of traced) {
      if (!tr.crossesPump) continue;
      if (!tr.flowSensor) continue;
      if (tr.valves.length === 0) continue;

      const overrideKey = `${tr.source}>${tr.destNodeId}`;
      const override = topology.route_overrides[overrideKey] ?? {};

      routes.push({
        name: override.name ?? overrideKey,
        source: tr.source,
        source_type: tr.sourceKind,
        destination: tr.destKind === "tank" ? tr.destNodeId : undefined,
        valves: tr.valves,
        flow_sensor: tr.flowSensor,
        max_runtime_seconds: override.max_runtime_seconds ?? 1800,
      });
    }
  }

  return {
    device: { ...topology.device },
    pump: { pin: pump.pin },
    tanks,
    water_sources: waterSources,
    valves,
    flow_sensors: flowSensors,
    routes,
    timing: { ...topology.timing },
  };
}
