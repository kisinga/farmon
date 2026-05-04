import type { Manifest, ManifestNode, ManifestAutomation, Route as ManifestRoute, TankLevelSource } from "./manifest.types";
import type { SystemTopology } from "./topology.types";
import { buildGraph, activeGraph, deriveRoutes } from "./graph/index";
import { slug } from "./slug";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * For each tank, find the first downstream level source (level_sensor or
 * pressure_sensor) in the active graph. If both kinds are present, the first
 * one encountered in the iteration order wins; level sensors are preferred
 * by checking them in priority order.
 *
 * Returns a map: tankId → { id, kind }.
 */
function resolveTankLevelSources(
  graph: ReturnType<typeof buildGraph>,
  nodeMap: Map<string, { kind: string; [k: string]: any }>,
): Map<string, TankLevelSource> {
  const LEVEL_SOURCE_KINDS = ['level_sensor', 'pressure_sensor'] as const;
  const result = new Map<string, TankLevelSource>();
  for (const [id, node] of nodeMap) {
    if (node.kind !== 'tank' || !graph.hasNode(id)) continue;
    // Prefer a direct level sensor; fall back to a pressure sensor.
    for (const wantedKind of LEVEL_SOURCE_KINDS) {
      let found: string | undefined;
      for (const neighbor of graph.outNeighbors(id)) {
        if (graph.hasNode(neighbor) && graph.getNodeAttribute(neighbor, 'kind') === wantedKind) {
          found = neighbor;
          break;
        }
      }
      if (found) {
        result.set(id, { id: found, kind: wantedKind });
        break;
      }
    }
  }
  return result;
}

// ---------------------------------------------------------------------------
// Main conversion
// ---------------------------------------------------------------------------

export function topologyToManifest(topology: SystemTopology): Manifest {
  const graph = buildGraph(topology.nodes, topology.pipes);
  const active = activeGraph(graph);
  const routes = deriveRoutes(active);

  // Only nodes connected via pipes enter the manifest.
  const connected = new Set<string>();
  for (const pipe of topology.pipes) {
    connected.add(pipe.from.split(':')[0]);
    connected.add(pipe.to.split(':')[0]);
  }

  const nodeMap = new Map(topology.nodes.map(n => [n.id, n]));

  // Resolve tank → level-source associations from graph topology
  const tankLevelSources = resolveTankLevelSources(active, nodeMap);

  // Strip layout fields (ports, position) — generators don't need them.
  // Annotate tanks with their associated level source.
  const nodes: ManifestNode[] = topology.nodes
    .filter(n => connected.has(n.id) && !n.disabled)
    .map(({ ports, position, ...data }) => {
      const node = data as ManifestNode;
      if (node.kind === 'tank') {
        const src = tankLevelSources.get(node.id);
        if (src) node['level_source'] = src;
      }
      return node;
    });

  // --- Route mapping ---

  const manifestRoutes: ManifestRoute[] = routes
    .filter(r => r.valid) // only routes with a flow sensor
    .map(r => {
      const override = topology.route_overrides[r.key] ?? {};
      const srcNode = nodeMap.get(r.source);
      const dstNode = nodeMap.get(r.destination);
      const srcLabel = (srcNode as any)?.name ?? r.source;
      const dstLabel = (dstNode as any)?.name ?? r.destination;

      // Determine if runtime level checks are reliable for this route.
      // Check pump_rated on whichever sensor (level or pressure) supplies
      // the source/dest tanks' level reading.
      const runtimeLevelOk = !r.crossesPump || (() => {
        const checkTank = (tankId: string | undefined) => {
          if (!tankId) return true;
          const tank = nodeMap.get(tankId);
          if (!tank || tank.kind !== 'tank') return true;
          const src = tankLevelSources.get(tankId);
          if (!src) return true; // no sensor = no level data = skip check
          const sensor = nodeMap.get(src.id);
          return !sensor || !!(sensor as any).pump_rated;
        };
        return checkTank(r.source) && checkTank(r.destination);
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
    device: { ...topology.device, name: slug(topology.device.friendly_name) },
    nodes,
    routes: manifestRoutes,
    timing: { ...topology.timing },
    automations,
  };
}
