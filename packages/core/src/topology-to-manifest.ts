import type { Manifest, ManifestNode, ManifestAutomation, Route as ManifestRoute } from "./manifest.types";
import type { SystemTopology } from "./topology.types";
import { buildGraph, activeGraph, deriveRoutes } from "./graph/index";
import { slug } from "./slug";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * For each tank, find the first downstream level_sensor in the active graph.
 * Returns a map: tankId → levelSensorId.
 */
function resolveTankLevelSensors(
  graph: ReturnType<typeof buildGraph>,
  nodeMap: Map<string, { kind: string; [k: string]: any }>,
): Map<string, string> {
  const result = new Map<string, string>();
  for (const [id, node] of nodeMap) {
    if (node.kind !== 'tank' || !graph.hasNode(id)) continue;
    // Check direct downstream neighbors for a level_sensor
    for (const neighbor of graph.outNeighbors(id)) {
      if (graph.hasNode(neighbor) && graph.getNodeAttribute(neighbor, 'kind') === 'level_sensor') {
        result.set(id, neighbor);
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

  // Resolve tank → level_sensor associations from graph topology
  const tankLevelSensors = resolveTankLevelSensors(active, nodeMap);

  // Strip layout fields (ports, position) — generators don't need them.
  // Annotate tanks with their associated level_sensor ID.
  const nodes: ManifestNode[] = topology.nodes
    .filter(n => connected.has(n.id) && !n.disabled)
    .map(({ ports, position, ...data }) => {
      const node = data as ManifestNode;
      if (node.kind === 'tank') {
        const lsId = tankLevelSensors.get(node.id);
        if (lsId) node['level_sensor'] = lsId;
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
      // Check pump_rated on the level_sensor connected to source/dest tanks.
      const runtimeLevelOk = !r.crossesPump || (() => {
        const checkTank = (tankId: string | undefined) => {
          if (!tankId) return true;
          const tank = nodeMap.get(tankId);
          if (!tank || tank.kind !== 'tank') return true;
          const lsId = tankLevelSensors.get(tankId);
          if (!lsId) return true; // no sensor = no level data = skip check
          const ls = nodeMap.get(lsId);
          return !ls || !!(ls as any).pump_rated;
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
