import type { Manifest, ManifestNode, ManifestAutomation, Route as ManifestRoute } from "./manifest.types";
import type { SiteTopology } from "./topology.types";
import { buildGraph, activeGraph, deriveRoutes } from "./graph/index";
import { resolveTankLevelSources } from "./tank-level";
import { slug } from "./slug";

// ---------------------------------------------------------------------------
// Per-controller manifest conversion
// ---------------------------------------------------------------------------

export function topologyToManifestForController(
  topology: SiteTopology,
  controllerId: string,
): Manifest {
  const graph = buildGraph(topology.nodes, topology.pipes);
  const active = activeGraph(graph);
  const allRoutes = deriveRoutes(active);

  // A controller runs routes whose flow sensor is anchored to it.
  // This controller is the safety brain for the route.
  const controllerRoutes = allRoutes.filter(r => {
    if (!r.valid) return false;
    const flowNode = topology.nodes.find(n => n.id === r.flowSensors[0]);
    return flowNode && flowNode.anchorId === controllerId;
  });

  // Only nodes that appear in this controller's routes enter the manifest.
  const routeNodeIds = new Set<string>();
  for (const r of controllerRoutes) {
    for (const id of r.nodeSequence) routeNodeIds.add(id);
  }

  const nodeMap = new Map(topology.nodes.map(n => [n.id, n]));
  const nodeKindById = new Map(topology.nodes.map(n => [n.id, n.kind]));

  // Resolve tank → level-source associations from graph topology
  const tankLevelSources = resolveTankLevelSources(active, nodeKindById);

  const pressureSensorToTank = new Map<string, string>();
  for (const [tankId, src] of tankLevelSources) {
    if (src.kind === 'pressure_sensor') pressureSensorToTank.set(src.id, tankId);
  }

  const pressureSensorIds = new Set(
    topology.nodes.filter(n => n.kind === 'pressure_sensor').map(n => n.id),
  );

  // Strip layout fields, annotate level sources and calibration data.
  const nodes: ManifestNode[] = topology.nodes
    .filter(n => routeNodeIds.has(n.id) && !n.disabled)
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

  const manifestRoutes: ManifestRoute[] = controllerRoutes.map(r => {
    const override = topology.route_overrides[r.key] ?? {};
    const srcNode = nodeMap.get(r.source);
    const dstNode = nodeMap.get(r.destination);
    const srcLabel = (srcNode as { name?: string } | undefined)?.name ?? r.source;
    const dstLabel = (dstNode as { name?: string } | undefined)?.name ?? r.destination;

    const runtimeLevelOk = !r.crossesPump || (() => {
      const checkTank = (tankId: string | undefined) => {
        if (!tankId) return true;
        const tank = nodeMap.get(tankId);
        if (!tank || tank.kind !== 'tank') return true;
        const src = tankLevelSources.get(tankId);
        if (!src) return true;
        if (src.kind === 'level_sensor') return true;
        const sensor = nodeMap.get(src.id);
        return !sensor || (sensor.kind === 'pressure_sensor' && !!(sensor as { pump_rated?: boolean }).pump_rated);
      };
      return checkTank(r.source) && checkTank(r.destination);
    })();

    const inlinePressureSensors = r.nodeSequence.filter(id => pressureSensorIds.has(id));

    const sourceHasLevel = r.sourceKind === 'tank' && tankLevelSources.has(r.source);
    const destHasLevel = r.destKind === 'tank' && tankLevelSources.has(r.destination);

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
      source_min_pct: sourceHasLevel ? (override.source_min_level ?? 0) : 0,
      dest_max_pct: destHasLevel ? (override.dest_max_level ?? 0) : 0,
      source_has_level: sourceHasLevel,
      dest_has_level: destHasLevel,
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

  const controller = topology.controllers.find(c => c.id === controllerId);

  return {
    device: {
      name: slug(controller?.board ?? controllerId),
      friendly_name: controllerId,
      board: controller?.board ?? '',
      directory: undefined,
      network: controller?.network,
    },
    nodes,
    routes: manifestRoutes,
    timing: { ...topology.timing },
    automations,
  };
}
