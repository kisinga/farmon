import type { Manifest, LocalManifestNode, ImportedManifestNode, ManifestAutomation, Route as ManifestRoute } from "./manifest.types";
import type { SiteTopology, TopologyNode, AutomationTrigger } from "./topology.types";
import { buildGraph, activeGraph, deriveRoutes } from "./graph/index";
import { deriveRemoteHaEntityId } from "./remote-ha-entity";
import { slug } from "./slug";
import { NODE_REGISTRY } from './entity-registry';

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
  const claimedNodeIds = new Set(
    topology.remoteImports
      .filter(c => c.controllerId === controllerId)
      .map(c => c.nodeId),
  );

  const isNodeIncluded = (nodeId: string) => {
    const node = topology.nodes.find(n => n.id === nodeId);
    if (!node) return false;
    if (node.anchorId === controllerId) return true;
    if (claimedNodeIds.has(nodeId)) return true;
    return false;
  };

  // ---------------------------------------------------------------------------
  // Controller segment assignment — actuator-centric
  //
  // A controller claims a segment if:
  //   1. It can access all actuators (pumps, valves) in the segment.
  //   2. Monitored segments: at least one flow sensor is local.
  //   3. Unmonitored segments: the destination is local (so the controller
  //      can read the destination level and know when to stop).
  //
  // Source nodes do NOT need to be local — their levels are read via remote
  // HA sensors when needed.
  // ---------------------------------------------------------------------------

  const canAccessActuator = (nodeId: string) => {
    const node = topology.nodes.find(n => n.id === nodeId);
    if (!node) return false;
    if (node.anchorId === controllerId) return true;
    if (claimedNodeIds.has(nodeId)) return true;
    return false;
  };

  const controllerRoutes = allRoutes.filter(r => {
    // Every actuator must be accessible
    for (const nodeId of r.nodeSequence) {
      const node = topology.nodes.find(n => n.id === nodeId);
      if (!node) return false;
      const desc = NODE_REGISTRY.get(node.kind);
      if ((desc?.conflictClass === 'actuator') && !canAccessActuator(nodeId)) {
        return false;
      }
    }

    // Monitored segments need a local flow sensor
    if (r.flowSensors.length > 0) {
      const hasLocalFlow = r.flowSensors.some(id => {
        const node = topology.nodes.find(n => n.id === id);
        return node && node.anchorId === controllerId;
      });
      if (!hasLocalFlow) return false;
    }

    // Unmonitored segments need a local destination (for level-based stopping)
    if (r.flowSensors.length === 0 && r.destination) {
      const destNode = topology.nodes.find(n => n.id === r.destination);
      if (!destNode || destNode.anchorId !== controllerId) return false;
    }

    return true;
  });

  // Collect waypoints referenced by claimed segments so their levels can be
  // read remotely (via homeassistant sensors) even when the waypoint lives
  // on another controller.
  const referencedWaypointIds = new Set<string>();
  for (const r of controllerRoutes) {
    referencedWaypointIds.add(r.source);
    if (r.destination) referencedWaypointIds.add(r.destination);
  }

  // Nodes that appear in this controller's routes (for route table generation).
  const routeNodeIds = new Set<string>();
  for (const r of controllerRoutes) {
    for (const id of r.nodeSequence) routeNodeIds.add(id);
  }

  const nodeMap = new Map(topology.nodes.map(n => [n.id, n]));
  const nodeKindById = new Map(topology.nodes.map(n => [n.id, n.kind]));

  const isLocalNode = (n: typeof topology.nodes[number]) => n.anchorId === controllerId;
  const isIncludedNode = (n: typeof topology.nodes[number]) => {
    if (n.disabled) return false;
    if (isLocalNode(n)) return true;
    if (claimedNodeIds.has(n.id)) return true;
    if (referencedWaypointIds.has(n.id)) return true;
    return false;
  };
  // Split into local and imported nodes
  const localNodes: LocalManifestNode[] = topology.nodes
    .filter(n => isIncludedNode(n) && isLocalNode(n))
    .map(node => {
      const manifestNode: LocalManifestNode = { ...node };
      // Derive remote HA entity for nodes whose primary value lives elsewhere
      const origNode = nodeMap.get(manifestNode.id);
      if (origNode) {
        const remoteHaEntityId = deriveRemoteHaEntityId(origNode, controllerId, topology);
        if (remoteHaEntityId) manifestNode.remoteHaEntityId = remoteHaEntityId;
      }
      return manifestNode;
    });

  const importedNodes: ImportedManifestNode[] = topology.nodes
    .filter(n => isIncludedNode(n) && !isLocalNode(n))
    .map(node => {
      const manifestNode: ImportedManifestNode = { ...node } as ImportedManifestNode;
      const origNode = nodeMap.get(manifestNode.id);
      if (origNode) {
        const remoteHaEntityId = deriveRemoteHaEntityId(origNode, controllerId, topology);
        if (remoteHaEntityId) manifestNode.remoteHaEntityId = remoteHaEntityId;
        const providerController = topology.controllers.find(c => c.id === origNode.anchorId);
        if (providerController) {
          manifestNode.remoteDeviceName = slug(providerController.friendlyName ?? providerController.id);
        }
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
        if (!(tank as Record<string, unknown>)['level_monitored']) return true;
        return !!(tank as { pressure_pump_rated?: boolean }).pressure_pump_rated;
      };
      return checkTank(r.source) && checkTank(r.destination);
    })();

    const sourceHasLevel = r.sourceKind === 'tank' && !!(nodeMap.get(r.source) as Record<string, unknown> | undefined)?.['level_monitored'];
    const destHasLevel = r.destKind === 'tank' && !!(nodeMap.get(r.destination) as Record<string, unknown> | undefined)?.['level_monitored'];

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
      monitored: r.flowSensors.length > 0,
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
    nodes: localNodes,
    imports: importedNodes,
    routes: manifestRoutes,
    timing: { ...topology.timing },
    automations,
  };
}
