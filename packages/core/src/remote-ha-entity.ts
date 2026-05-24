import { NODE_REGISTRY } from './entity-registry';
import type { SiteTopology } from './topology.types';
import type { TankLevelSource } from './tank-level';

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
  tankLevelSources: Map<string, TankLevelSource>,
): string | undefined {
  const desc = NODE_REGISTRY.get(node.kind);
  if (!desc) return undefined;

  // Tank: resolve via level source (may be on a different controller than the tank)
  if (node.kind === 'tank') {
    const src = tankLevelSources.get(node.id);
    if (!src) return undefined;
    const srcNode = topology.nodes.find(n => n.id === src.id);
    if (!srcNode) return undefined;
    // Level source is local — no remote HA entity needed
    if (srcNode.anchorId === controllerId) return undefined;
    const srcDesc = NODE_REGISTRY.get(srcNode.kind);
    if (!srcDesc?.codegen?.haEntityIds) return undefined;
    const providerController = topology.controllers.find(c => c.id === srcNode.anchorId);
    const device = { friendly_name: providerController?.friendlyName ?? srcNode.anchorId };
    const declared = srcDesc.codegen.haEntityIds(srcNode as Record<string, any>, device);
    return declared?.['level'];
  }

  // All other kinds: check if node itself is remote
  if (node.anchorId === controllerId) return undefined;

  if (!desc.codegen?.haEntityIds) return undefined;
  const providerController = topology.controllers.find(c => c.id === node.anchorId);
  const device = { friendly_name: providerController?.friendlyName ?? node.anchorId };
  const declared = desc.codegen.haEntityIds(node as Record<string, any>, device);
  if (!declared) return undefined;

  // Pick canonical entity matching haDomain
  for (const entityId of Object.values(declared)) {
    if (entityId && entityId.startsWith(`${desc.haDomain}.`)) return entityId;
  }
  return undefined;
}
