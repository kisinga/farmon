import type { Manifest, ManifestNode, ManifestAutomation, Route as ManifestRoute } from "./manifest.types";
import type { SystemTopology } from "./topology.types";
import { buildGraph, activeGraph, deriveRoutes } from "./graph/index";
import { resolveTankLevelSources } from "./tank-level";
import { slug } from "./slug";

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
  const nodeKindById = new Map(topology.nodes.map(n => [n.id, n.kind]));

  // Resolve tank → level-source associations from graph topology
  const tankLevelSources = resolveTankLevelSources(active, nodeKindById);

  // Inverse map: pressure-sensor id → its parent tank id (when the sensor is
  // that tank's level source). Used to annotate the sensor with the tank's
  // height_m / capacity_l so codegen and validation see calibration inputs
  // in their original shape (`tank_height_m` / `tank_capacity_l`) without
  // each having to walk the graph.
  const pressureSensorToTank = new Map<string, string>();
  for (const [tankId, src] of tankLevelSources) {
    if (src.kind === 'pressure_sensor') pressureSensorToTank.set(src.id, tankId);
  }

  // All pressure-sensor node ids — used to derive per-route lists below.
  const pressureSensorIds = new Set(
    topology.nodes.filter(n => n.kind === 'pressure_sensor').map(n => n.id),
  );

  // Strip layout fields (ports, position) — generators don't need them.
  // Annotate tanks with their associated level source. Annotate pressure
  // sensors with their parent tank's dimensions when they are a tank-level
  // source — keeping calibration inputs co-located with the sensor for
  // backward-compatible codegen.
  const nodes: ManifestNode[] = topology.nodes
    .filter(n => connected.has(n.id) && !n.disabled)
    .map(({ ports, position, ...data }) => {
      const node = data as ManifestNode;
      if (node.kind === 'tank') {
        const src = tankLevelSources.get(node.id);
        if (src) node['level_source'] = src;
      }
      if (node.kind === 'pressure_sensor') {
        const parentTankId = pressureSensorToTank.get(node.id);
        if (parentTankId) {
          const tank = nodeMap.get(parentTankId) as Record<string, unknown> | undefined;
          const h = tank?.['height_m'];
          const c = tank?.['capacity_l'];
          if (typeof h === 'number') node['tank_height_m'] = h;
          if (typeof c === 'number') node['tank_capacity_l'] = c;
        }
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
      // Level sensors are intrinsically tank-mounted → always pump-safe, no
      // flag to consult. Pressure sensors carry the pump_rated flag because
      // they can be plumbed inline near a pump where pump operation
      // disturbs the reading.
      const runtimeLevelOk = !r.crossesPump || (() => {
        const checkTank = (tankId: string | undefined) => {
          if (!tankId) return true;
          const tank = nodeMap.get(tankId);
          if (!tank || tank.kind !== 'tank') return true;
          const src = tankLevelSources.get(tankId);
          if (!src) return true; // no sensor = no level data = skip check
          if (src.kind === 'level_sensor') return true; // level sensors are pump-safe by construction
          const sensor = nodeMap.get(src.id);
          return !sensor || !!(sensor as any).pump_rated;
        };
        return checkTank(r.source) && checkTank(r.destination);
      })();

      // Pressure sensors that lie on this route's path. Pure metadata for
      // downstream consumers — the firmware doesn't read it.
      const inlinePressureSensors = r.nodeSequence.filter(id => pressureSensorIds.has(id));

      return {
        key: r.key,
        name: `${srcLabel} > ${dstLabel}`,
        source: r.source,
        source_type: r.sourceKind as 'tank' | 'water_source',
        destination: r.destKind === 'tank' ? r.destination : undefined,
        valves: r.valves,
        flow_sensor: r.flowSensors[0],
        max_runtime_seconds: override.max_runtime_seconds ?? 1800,
        crossesPump: r.crossesPump,
        pumpIndex: r.pumpIndex,
        nodeSequence: r.nodeSequence,
        source_min_pct: override.source_min_level ?? 0,
        dest_max_pct: override.dest_max_level ?? 0,
        runtime_level_ok: runtimeLevelOk,
        inline_pressure_sensors: inlinePressureSensors,
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
