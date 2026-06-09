import { migrateTopology } from './topology-schema';
import { buildGraph } from './graph/topology-graph';
import { activeGraph } from './graph/active-graph';
import { deriveRoutes } from './graph/routes';
import type { SiteTopology } from './topology.types';

/**
 * Upgrade a pre-`remoteImports` draft (schema < 18) to the current model: bump
 * the schema, then derive each controller's cross-controller node imports from
 * route analysis. For every route a controller owns — all actuators local, plus
 * a local flow sensor when monitored or a local destination when not — every
 * remote node on that route is recorded as an import. Idempotent per pair.
 */
export function migrateToRemoteImports(topology: SiteTopology): SiteTopology {
  const migrated = migrateTopology({
    ...topology,
    schema: 18,
    remoteImports: [],
  }) as SiteTopology;

  const graph = buildGraph(topology.nodes, topology.pipes);
  const active = activeGraph(graph);
  const allRoutes = deriveRoutes(active);

  for (const controller of topology.controllers) {
    const controllerRoutes = allRoutes.filter((r) => {
      // All actuators must be local to this controller
      const allActuatorsLocal = r.nodeSequence.every((id) => {
        const node = topology.nodes.find((n) => n.id === id);
        if (!node) return false;
        if (node.kind !== 'pump' && node.kind !== 'valve') return true;
        return node.anchorId === controller.id;
      });
      if (!allActuatorsLocal) return false;

      // Monitored: needs a local flow sensor
      if (r.monitored) {
        return r.flowSensors.some((id) => {
          const node = topology.nodes.find((n) => n.id === id);
          return node && node.anchorId === controller.id;
        });
      }

      // Unmonitored: needs local destination for level-based stopping
      const destNode = topology.nodes.find((n) => n.id === r.destination);
      return destNode && destNode.anchorId === controller.id;
    });

    for (const route of controllerRoutes) {
      for (const nodeId of route.nodeSequence) {
        const node = topology.nodes.find((n) => n.id === nodeId);
        if (!node) continue;
        if (node.anchorId === controller.id) continue;
        const exists = migrated.remoteImports.some(
          (ri) => ri.controllerId === controller.id && ri.nodeId === nodeId,
        );
        if (!exists) {
          migrated.remoteImports.push({ controllerId: controller.id, nodeId });
        }
      }
    }
  }

  return migrated;
}
