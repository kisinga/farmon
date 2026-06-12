import type { ManifestRule, RuleDiagnostic } from "../rule.types";
import type { Manifest } from "@core";
import type { BoardDef } from "@core";
import { boardSupportedTransports } from '@core';

export const remoteNodes: ManifestRule = {
  id: 'remote-nodes',
  name: 'Remote node validation',
  evaluate(m: Manifest, board: BoardDef): RuleDiagnostic[] {
    const diagnostics: RuleDiagnostic[] = [];
    const hasIpTransport = boardSupportedTransports(board).includes('wifi')
      || boardSupportedTransports(board).includes('ethernet');

    for (const node of m.nodes) {
      // anchorId tells us if a node is remote; remoteSourceRef tells us if a
      // mirrored value could be resolved for it. A node can be remote without a
      // remoteSourceRef (e.g. a remote water_source without a pressure pin).
      const controllerId = m.controllerId ?? m.device.friendly_name;
      if (!node.anchorId || node.anchorId === controllerId) continue;

      if (!node.remoteSourceRef) {
        diagnostics.push({
          severity: 'error',
          message: `Remote node "${node.name || node.id}" (anchored to ${node.anchorId}) has no mirrored value to read over the cross-controller link. Verify the owning controller exposes a readable value for this node kind.`,
          target: String(node.id),
          ruleId: 'remote-nodes:unresolved-provider',
        });
      }

      if (!hasIpTransport) {
        diagnostics.push({
          severity: 'error',
          message: `Remote node "${node.name || node.id}" requires IP transport (WiFi or Ethernet) for the UDP coordination lane. Board "${board.label}" does not support either.`,
          target: String(node.id),
          ruleId: 'remote-nodes:no-ip-transport',
        });
      }
    }

    return diagnostics;
  },
};
