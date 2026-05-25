import type { Manifest, ManifestNode, ManifestAutomation, Route as ManifestRoute } from "./manifest.types";
import type { SiteTopology, TopologyNode, AutomationTrigger } from "./topology.types";
import { buildGraph, activeGraph, deriveRoutes } from "./graph/index";
import { resolveTankLevelSources } from "./tank-level";
import { deriveRemoteHaEntityId } from "./remote-ha-entity";
import { slug } from "./slug";

function assertSourceKind(kind: TopologyNode['kind']): asserts kind is 'tank' | 'water_source' {
  if (kind !== 'tank' && kind !== 'water_source') {
    throw new Error(`Invalid source kind: ${kind}`);
  }
}

function mapTrigger(trigger: AutomationTrigger): ManifestAutomation['trigger'] {
  if (trigger.type === 'time') {
    if (!trigger.at) throw new Error('Time trigger missing "at"');
    return { type: 'time', at: trigger.at };
  }
  return { type: 'level', for_minutes: trigger.for_minutes };
}

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

  // Nodes that appear in this controller's routes (for route table generation).
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

  // A node is included in a controller's manifest if it is either anchored
  // locally OR explicitly imported via a RemoteImport. No auto-inclusion of
  // route nodes — the consumer must explicitly import what it needs.
  const claimedNodeIds = new Set(
    topology.remoteImports
      .filter(c => c.controllerId === controllerId)
      .map(c => c.nodeId),
  );
  const isLocalNode = (n: typeof topology.nodes[number]) => n.anchorId === controllerId;
  const isIncludedNode = (n: typeof topology.nodes[number]) => {
    if (n.disabled) return false;
    if (isLocalNode(n)) return true;
    if (claimedNodeIds.has(n.id)) return true;
    return false;
  };
  const nodes: ManifestNode[] = topology.nodes
    .filter(isIncludedNode)
    .map(node => {
      const manifestNode: ManifestNode = { ...node };
      if (manifestNode.kind === 'tank') {
        const src = tankLevelSources.get(manifestNode.id);
        if (src) manifestNode.level_source = src;
      }
      if (manifestNode.kind === 'pressure_sensor') {
        const parentTankId = pressureSensorToTank.get(manifestNode.id);
        if (parentTankId) {
          const tank = nodeMap.get(parentTankId);
          if (tank && tank.kind === 'tank') {
            if (tank.height_m != null) manifestNode.tank_height_m = tank.height_m;
            if (tank.capacity_l != null) manifestNode.tank_capacity_l = tank.capacity_l;
          }
        }
      }
      // Derive remote HA entity for nodes whose primary value lives elsewhere
      const origNode = nodeMap.get(manifestNode.id);
      if (origNode) {
        const remoteHaEntityId = deriveRemoteHaEntityId(origNode, controllerId, topology, tankLevelSources);
        if (remoteHaEntityId) manifestNode.remoteHaEntityId = remoteHaEntityId;
      }
      return manifestNode;
    });

  // --- Route mapping ---

  const manifestRoutes: ManifestRoute[] = controllerRoutes.map(r => {
    const override = topology.route_overrides[r.key] ?? {};
    const srcNode = nodeMap.get(r.source);
    const dstNode = nodeMap.get(r.destination);
    const srcLabel = srcNode?.name ?? r.source;
    const dstLabel = dstNode?.name ?? r.destination;

    const runtimeLevelOk = !r.crossesPump || (() => {
      const checkTank = (tankId: string | undefined) => {
        if (!tankId) return true;
        const tank = nodeMap.get(tankId);
        if (!tank || tank.kind !== 'tank') return true;
        const src = tankLevelSources.get(tankId);
        if (!src) return true;
        if (src.kind === 'level_sensor') return true;
        const sensor = nodeMap.get(src.id);
        return !sensor || (sensor.kind === 'pressure_sensor' && !!sensor.pump_rated);
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
      source_type: ((): 'tank' | 'water_source' => { assertSourceKind(r.sourceKind); return r.sourceKind; })(),
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
        trigger: mapTrigger(a.trigger),
        days_of_week: a.days_of_week,
        enabled: a.enabled,
      };
    });

  const controller = topology.controllers.find(c => c.id === controllerId);

  return {
    controllerId,
    device: {
      name: slug(controller?.friendlyName ?? controllerId),
      friendly_name: controller?.friendlyName ?? controllerId,
      board: controller?.board ?? '',
      directory: controller?.directory,
      network: controller?.network,
      uart_buses: controller?.uart_buses,
      io_providers: controller?.io_providers,
    },
    nodes,
    routes: manifestRoutes,
    timing: { ...topology.timing },
    automations,
  };
}
