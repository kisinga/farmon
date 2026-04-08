import type { Manifest, ManifestNode, ManifestAutomation, Route as ManifestRoute } from "./schema.js";
import type { Topology } from "./topology.js";
import { buildGraph, activeGraph, deriveRoutes } from "../../shared/graph/index.js";

// ---------------------------------------------------------------------------
// Main conversion
// ---------------------------------------------------------------------------

export function topologyToManifest(topology: Topology): Manifest {
  const graph = buildGraph(topology.nodes, topology.pipes);
  const active = activeGraph(graph);
  const routes = deriveRoutes(active);

  // Only nodes connected via pipes enter the manifest.
  const connected = new Set<string>();
  for (const pipe of topology.pipes) {
    connected.add(pipe.from.split(':')[0]);
    connected.add(pipe.to.split(':')[0]);
  }

  // Strip layout fields (ports, position) — generators don't need them.
  const nodes: ManifestNode[] = topology.nodes
    .filter(n => connected.has(n.id) && !n.disabled)
    .map(({ ports, position, ...data }) => data as ManifestNode);

  // --- Route mapping ---

  const nodeMap = new Map(topology.nodes.map(n => [n.id, n]));

  const manifestRoutes: ManifestRoute[] = routes
    .filter(r => r.valid) // only routes with a flow sensor
    .map(r => {
      const override = topology.route_overrides[r.key] ?? {};
      const srcNode = nodeMap.get(r.source);
      const dstNode = nodeMap.get(r.destination);
      const srcLabel = (srcNode as any)?.name ?? r.source;
      const dstLabel = (dstNode as any)?.name ?? r.destination;

      // Determine if runtime level checks are reliable for this route
      const runtimeLevelOk = !r.crossesPump || (() => {
        // If route crosses pump, check if source/dest tank sensors are pump-rated
        const srcNode = nodeMap.get(r.source);
        const dstNode = nodeMap.get(r.destination);
        const srcOk = !srcNode || srcNode.kind !== 'tank' || !!(srcNode as any).pump_rated;
        const dstOk = !dstNode || dstNode.kind !== 'tank' || !!(dstNode as any).pump_rated;
        return srcOk && dstOk;
      })();

      return {
        key: r.key,
        name: `${srcLabel} > ${dstLabel}`,
        source: r.source,
        source_type: r.sourceKind as 'tank' | 'water_source',
        destination: r.destKind === 'tank' ? r.destination : undefined,
        valves: r.valves,
        flow_sensor: r.flowSensors[0],
        max_runtime_seconds: override.max_runtime_seconds ?? 1800,
        needs_pump: r.crossesPump,
        nodeSequence: r.nodeSequence,
        source_min_pct: override.source_min_level ?? 0,
        dest_max_pct: override.dest_max_level ?? 0,
        runtime_level_ok: runtimeLevelOk,
      };
    });

  // --- Automation resolution ---

  const routeKeyToIndex = new Map(manifestRoutes.map((r, i) => [r.key, i]));

  const automations: ManifestAutomation[] = (topology.automations ?? [])
    .filter(a => {
      if (!routeKeyToIndex.has(a.route)) {
        console.warn(`Automation "${a.id}" references unknown route "${a.route}" — skipped`);
        return false;
      }
      return true;
    })
    .map(a => {
      const idx = routeKeyToIndex.get(a.route)!;
      return {
        id: a.id,
        name: a.name,
        route_index: idx,
        route_key: a.route,
        route_name: manifestRoutes[idx].name,
        trigger: a.trigger as ManifestAutomation['trigger'],
        days_of_week: a.days_of_week,
        enabled: a.enabled,
      };
    });

  return {
    device: { ...topology.device },
    nodes,
    routes: manifestRoutes,
    timing: { ...topology.timing },
    automations,
  };
}
