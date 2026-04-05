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
  source: string;         // source tank id
  destNodeId: string;     // destination node id (tank or endpoint)
  destKind: "tank" | "endpoint";
  valves: string[];       // valve ids along the path, in order
  flowSensor: string | undefined;
  crossesPump: boolean;
}

/**
 * BFS from a source tank through pipes to all reachable terminal nodes
 * (tanks and endpoints). Collects valves, flow sensors, and pump crossing.
 */
function traceRoutes(
  sourceId: string,
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

      // Collect inline components on this pipe segment
      const pipeValves = pipe.components
        .filter((c) => c.kind === "valve")
        .map((c) => c.id);
      const pipeFlow = pipe.components.find((c) => c.kind === "flow_sensor");

      const nextValves = [...entry.valves, ...pipeValves];
      const nextFlow = pipeFlow ? pipeFlow.id : entry.flowSensor;
      const nextPump = entry.crossesPump || target.kind === "pump";
      const nextVisited = new Set(entry.visited);
      nextVisited.add(targetId);

      if (target.kind === "tank" || target.kind === "endpoint") {
        // Terminal node — record the route
        results.push({
          source: sourceId,
          destNodeId: target.id,
          destKind: target.kind,
          valves: nextValves,
          flowSensor: nextFlow,
          crossesPump: nextPump,
        });
      } else {
        // Intermediate node (pump) — keep traversing
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

  // --- Flat component extraction ---

  const tanks = topology.nodes
    .filter((n): n is Extract<TopologyNode, { kind: "tank" }> => n.kind === "tank")
    .map((t) => ({ name: t.name, id: t.id, level_pin: t.level_pin }));

  const pump = topology.nodes.find((n) => n.kind === "pump");
  if (!pump || pump.kind !== "pump") {
    throw new Error("Topology must contain exactly one pump node");
  }

  const valves: Manifest["valves"] = [];
  const flowSensors: Manifest["flow_sensors"] = [];
  const seen = new Set<string>();

  for (const pipe of topology.pipes) {
    for (const comp of pipe.components) {
      if (seen.has(comp.id)) continue;
      seen.add(comp.id);

      if (comp.kind === "valve") {
        valves.push({
          name: comp.name,
          id: comp.id,
          open_pin: comp.open_pin,
          close_pin: comp.close_pin,
        });
      } else {
        flowSensors.push({
          name: comp.name,
          id: comp.id,
          pin: comp.pin,
          flow_cal: comp.flow_cal,
        });
      }
    }
  }

  // --- Route derivation ---

  const routes: Manifest["routes"] = [];

  for (const tank of tanks) {
    const traced = traceRoutes(tank.id, adj, nodes);

    for (const tr of traced) {
      // Skip passive paths (don't cross the pump)
      if (!tr.crossesPump) continue;
      // Skip invalid routes (no flow sensor)
      if (!tr.flowSensor) continue;
      // Must have at least one valve
      if (tr.valves.length === 0) continue;

      const overrideKey = `${tr.source}>${tr.destNodeId}`;
      const override = topology.route_overrides[overrideKey] ?? {};

      routes.push({
        name: override.name ?? overrideKey,
        source: tr.source,
        // Manifest uses destination=undefined for endpoints, tank id for tanks
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
    valves,
    flow_sensors: flowSensors,
    routes,
    timing: { ...topology.timing },
  };
}
