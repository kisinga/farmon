import type { Manifest, Route } from "./schema.js";
import type {
  Topology,
  TopologyNode,
  PipeSegment,
  InlineComponent,
  Port,
} from "./topology.js";
import { portRef } from "./topology.js";

// ---------------------------------------------------------------------------
// Migration: Manifest (schema 2) → Topology (schema 3)
//
// This is a best-effort heuristic. It infers physical pipe topology from
// the flat route definitions. The result is a valid starting point that
// users can refine on the canvas.
//
// Core assumption: all routes pass through a single pump. Source tanks
// connect to the pump inlet; the pump outlet fans out to destinations.
// ---------------------------------------------------------------------------

/** Infer endpoints from routes that have no destination (destination=undefined). */
function inferEndpoints(routes: Route[]): Map<string, string> {
  // Group endpoint routes by their unique valve+flow combination to deduplicate.
  // Use route name as the endpoint id/name hint.
  const endpoints = new Map<string, string>(); // routeName → endpointId

  for (const r of routes) {
    if (r.destination) continue;

    // Derive endpoint id from route name: "T1>H2" → "h2", fallback to flow sensor
    const match = r.name.match(/>(.+)$/);
    const endpointId = match
      ? match[1].toLowerCase().replace(/\s+/g, "_")
      : `endpoint_${r.flow_sensor}`;

    // Deduplicate: multiple routes to the same endpoint (T1>H2, T2>H2)
    // share the same destination valve+flow combo
    const destKey = [...r.valves].sort().join(",") + ":" + r.flow_sensor;
    if (!endpoints.has(destKey)) {
      endpoints.set(destKey, endpointId);
    }
  }

  return endpoints;
}

/**
 * For a set of routes from the same source, find valves that appear in ALL
 * of them. These are on the source-to-pump pipe.
 */
function findSourceValves(routes: Route[]): Set<string> {
  if (routes.length === 0) return new Set();
  if (routes.length === 1) {
    // With only one route from a source, we can't distinguish source vs dest valves.
    // Heuristic: first valve is on the source side.
    return new Set([routes[0].valves[0]]);
  }

  // Valves common to ALL routes from this source
  const sets = routes.map((r) => new Set(r.valves));
  const common = new Set(sets[0]);
  for (let i = 1; i < sets.length; i++) {
    for (const v of common) {
      if (!sets[i].has(v)) common.delete(v);
    }
  }
  return common;
}

/**
 * For a set of routes to the same destination, find valves unique to that
 * destination (not on the source side).
 */
function findDestValves(route: Route, sourceValves: Set<string>): string[] {
  return route.valves.filter((v) => !sourceValves.has(v));
}

export function manifestToTopology(manifest: Manifest): Topology {
  const nodes: TopologyNode[] = [];
  const pipes: PipeSegment[] = [];
  const routeOverrides: Record<string, { name?: string; max_runtime_seconds?: number }> = {};

  // Track which components have been placed on pipes to avoid duplicates
  const placedComponents = new Set<string>();
  let pipeCounter = 0;
  const nextPipeId = () => `pipe${++pipeCounter}`;

  // --- Layout constants ---
  const LEFT_X = 100;
  const CENTER_X = 400;
  const RIGHT_X = 700;
  const Y_SPACING = 150;

  // --- Create tank nodes ---
  const tankNodes = manifest.tanks.map((t, i) => ({
    kind: "tank" as const,
    id: t.id,
    name: t.name,
    level_pin: t.level_pin,
    ports: [
      { id: "inlet", label: "Inlet", direction: "inlet" as const },
      { id: "outlet", label: "Outlet", direction: "outlet" as const },
    ],
    position: { x: LEFT_X, y: 100 + i * Y_SPACING },
  }));
  nodes.push(...tankNodes);

  // --- Create pump node ---
  const pumpNode: TopologyNode = {
    kind: "pump",
    id: "pump",
    pin: manifest.pump.pin,
    ports: [
      { id: "in", label: "Inlet", direction: "inlet" as const },
      { id: "out", label: "Outlet", direction: "outlet" as const },
    ],
    position: { x: CENTER_X, y: 100 + ((manifest.tanks.length - 1) * Y_SPACING) / 2 },
  };
  nodes.push(pumpNode);

  // --- Infer endpoint nodes ---
  const endpointMap = inferEndpoints(manifest.routes);
  // Build reverse map: for a route without destination, find its endpoint id
  const routeToEndpoint = new Map<string, string>();
  for (const r of manifest.routes) {
    if (r.destination) continue;
    const destKey = [...r.valves].sort().join(",") + ":" + r.flow_sensor;
    routeToEndpoint.set(r.name, endpointMap.get(destKey)!);
  }

  const uniqueEndpoints = new Set(endpointMap.values());
  let endpointIdx = 0;
  for (const epId of uniqueEndpoints) {
    // Derive a friendly name from the id
    const friendlyName = epId
      .replace(/_/g, " ")
      .replace(/\b\w/g, (c) => c.toUpperCase());

    nodes.push({
      kind: "endpoint",
      id: epId,
      name: friendlyName,
      ports: [{ id: "inlet", label: "Inlet", direction: "inlet" as const }],
      position: { x: RIGHT_X, y: 100 + (manifest.tanks.length + endpointIdx) * Y_SPACING },
    });
    endpointIdx++;
  }

  // Move destination tanks to the right side for layout clarity
  for (const t of tankNodes) {
    const isDestination = manifest.routes.some((r) => r.destination === t.id);
    const isSource = manifest.routes.some((r) => r.source === t.id);
    if (isDestination && !isSource) {
      // Pure destination tank — move to right
      t.position.x = RIGHT_X;
    } else if (isDestination && isSource) {
      // Both source and destination — position in middle-right
      t.position.x = RIGHT_X;
    }
  }

  // --- Group routes by source tank ---
  const routesBySource = new Map<string, Route[]>();
  for (const r of manifest.routes) {
    const list = routesBySource.get(r.source) ?? [];
    list.push(r);
    routesBySource.set(r.source, list);
  }

  // --- Build source-to-pump pipes ---
  const sourceValvesByTank = new Map<string, Set<string>>();
  for (const [sourceId, routes] of routesBySource) {
    const srcValves = findSourceValves(routes);
    sourceValvesByTank.set(sourceId, srcValves);

    const components: InlineComponent[] = [];
    // Place source-side valves on this pipe
    for (const vId of srcValves) {
      if (placedComponents.has(vId)) continue;
      const valve = manifest.valves.find((v) => v.id === vId);
      if (!valve) continue;
      components.push({
        kind: "valve",
        id: valve.id,
        name: valve.name,
        open_pin: valve.open_pin,
        close_pin: valve.close_pin,
      });
      placedComponents.add(vId);
    }

    pipes.push({
      id: nextPipeId(),
      from: portRef(sourceId, "outlet"),
      to: portRef("pump", "in"),
      components,
    });
  }

  // --- Build pump-to-destination pipes ---
  // Group routes by destination to merge shared pipes
  const routesByDest = new Map<string, Route[]>();
  for (const r of manifest.routes) {
    const destId = r.destination ?? routeToEndpoint.get(r.name) ?? "unknown";
    const list = routesByDest.get(destId) ?? [];
    list.push(r);
    routesByDest.set(destId, list);
  }

  for (const [destId, routes] of routesByDest) {
    const components: InlineComponent[] = [];

    // Find destination-specific valves (appear in routes to this dest, not source valves)
    const destValveIds = new Set<string>();
    for (const r of routes) {
      const srcValves = sourceValvesByTank.get(r.source) ?? new Set();
      for (const vId of findDestValves(r, srcValves)) {
        destValveIds.add(vId);
      }
    }

    // Place destination valves
    for (const vId of destValveIds) {
      if (placedComponents.has(vId)) continue;
      const valve = manifest.valves.find((v) => v.id === vId);
      if (!valve) continue;
      components.push({
        kind: "valve",
        id: valve.id,
        name: valve.name,
        open_pin: valve.open_pin,
        close_pin: valve.close_pin,
      });
      placedComponents.add(vId);
    }

    // Place flow sensor (all routes to same dest share the same flow sensor)
    const flowId = routes[0].flow_sensor;
    if (!placedComponents.has(flowId)) {
      const flow = manifest.flow_sensors.find((f) => f.id === flowId);
      if (flow) {
        components.push({
          kind: "flow_sensor",
          id: flow.id,
          name: flow.name,
          pin: flow.pin,
          flow_cal: flow.flow_cal,
        });
        placedComponents.add(flowId);
      }
    }

    // Determine the destination port
    const destNode = nodes.find((n) => n.id === destId);
    const destPortId = destNode?.kind === "pump" ? "in" : "inlet";

    pipes.push({
      id: nextPipeId(),
      from: portRef("pump", "out"),
      to: portRef(destId, destPortId),
      components,
    });
  }

  // --- Route overrides ---
  for (const r of manifest.routes) {
    const destId = r.destination ?? routeToEndpoint.get(r.name) ?? "unknown";
    const key = `${r.source}>${destId}`;
    // Only set if not already present (first route to this dest wins for name)
    if (!routeOverrides[key]) {
      routeOverrides[key] = {
        name: r.name,
        max_runtime_seconds: r.max_runtime_seconds,
      };
    }
  }

  return {
    schema: 3,
    device: { ...manifest.device },
    nodes,
    pipes,
    route_overrides: routeOverrides,
    timing: { ...manifest.timing },
  };
}
