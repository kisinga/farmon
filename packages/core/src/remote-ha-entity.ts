import { NODE_REGISTRY } from './entity-registry';
import type { SiteTopology } from './topology.types';

/**
 * Derive the HA entity_id a remote node should be read from.
 *
 * For most kinds this is the node's own canonical HA entity on its home
 * controller. For tanks it is the level source sensor's HA entity (which may
 * be on a different controller than the tank itself).
 *
 * Returns `undefined` when no remote entity can be resolved.
 */
export function deriveRemoteHaEntityId(
  node: SiteTopology['nodes'][number],
  controllerId: string,
  topology: SiteTopology,
): string | undefined {
  const desc = NODE_REGISTRY.get(node.kind);
  if (!desc) return undefined;

  // Tank: if level_monitored and remote, the level entity is the tank's own HA entity
  if (node.kind === 'tank') {
    if (!(node as { level_monitored?: boolean }).level_monitored) return undefined;
    if (node.anchorId === controllerId) return undefined;
    const providerController = topology.controllers.find(c => c.id === node.anchorId);
    const device = { friendly_name: providerController?.friendlyName ?? node.anchorId };
    const declared = desc.codegen?.haEntityIds?.(node, device);
    return declared?.['level'];
  }

  // All other kinds: check if node itself is remote
  if (node.anchorId === controllerId) return undefined;

  if (!desc.codegen?.haEntityIds) return undefined;
  const providerController = topology.controllers.find(c => c.id === node.anchorId);
  const device = { friendly_name: providerController?.friendlyName ?? node.anchorId };
  const declared = desc.codegen.haEntityIds(node, device);
  if (!declared) return undefined;

  // Pick canonical entity matching haDomain
  for (const entityId of Object.values(declared)) {
    if (entityId && entityId.startsWith(`${desc.haDomain}.`)) return entityId;
  }
  return undefined;
}
