import { NODE_REGISTRY } from './entity-registry';
import type { SiteTopology } from './topology.types';

/**
 * Ref to the cross-controller source a node's value is read from, or `undefined`
 * when the node is read locally.
 *
 * A node is "remote" when it is anchored to a different controller than the one
 * being generated. Such a node has no local hardware here; instead the firmware
 * mirrors the owner's value over the UDP coordination lane into a local
 * `ri_<id>` read-import sensor (see coordination.ts and the `remoteProxy` codegen
 * in collect.ts). The returned ref is the node id — i.e. the `ri_<id>` key.
 *
 * Only the truthiness drives codegen: routes.ts / collect.ts branch on it, and
 * the actual read is `id(ri_<id>).state`. We therefore mark exactly the kinds
 * that can be mirrored (those with a `remoteProxy`); for the others the marker
 * is inert (no proxy is emitted and they appear in no read-case), so omitting it
 * produces identical firmware.
 *
 * Tanks mirror unconditionally at the proxy layer, but a tank with no intrinsic
 * level (not `level_monitored`, or no pressure pin) has nothing to read and must
 * fall back to the local `-1.0f` path — so tanks keep that guard.
 */
export function deriveRemoteSourceRef(
  node: SiteTopology['nodes'][number],
  controllerId: string,
): string | undefined {
  if (!node.anchorId || node.anchorId === controllerId) return undefined;

  const desc = NODE_REGISTRY.get(node.kind);
  if (!desc?.codegen?.remoteProxy) return undefined;

  if (node.kind === 'tank') {
    const t = node as { level_monitored?: boolean; pressure_pin?: string };
    if (!(t.level_monitored && t.pressure_pin)) return undefined;
  }

  return node.id;
}
