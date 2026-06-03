import type { ManifestRule, RuleDiagnostic } from "../rule.types";
import type { Manifest } from "@far-mon/core";
import type { BoardDef } from "@far-mon/core";
import { boardSupportedTransports } from '@far-mon/core';

export const remoteNodes: ManifestRule = {
  id: 'remote-nodes',
  name: 'Remote node validation',
  evaluate(m: Manifest, board: BoardDef): RuleDiagnostic[] {
    const diagnostics: RuleDiagnostic[] = [];
    const hasIpTransport = boardSupportedTransports(board).includes('wifi')
      || boardSupportedTransports(board).includes('ethernet');

    for (const node of m.nodes) {
      // anchorId tells us if a node is remote; remoteHaEntityId tells us if
      // its HA entity was successfully resolved. A node can be remote without
      // remoteHaEntityId (e.g. a remote water_source without a pressure pin).
      const controllerId = m.controllerId ?? m.device.friendly_name;
      if (!node.anchorId || node.anchorId === controllerId) continue;

      if (!node.remoteHaEntityId) {
        diagnostics.push({
          severity: 'error',
          message: `Remote node "${node.name || node.id}" (anchored to ${node.anchorId}) could not resolve a Home Assistant entity. Verify the provider controller exports HA entities for this node kind.`,
          target: String(node.id),
          ruleId: 'remote-nodes:unresolved-provider',
        });
      }

      if (!hasIpTransport) {
        diagnostics.push({
          severity: 'error',
          message: `Remote node "${node.name || node.id}" requires IP transport (WiFi or Ethernet) for the ESPHome homeassistant platform. Board "${board.label}" does not support either.`,
          target: String(node.id),
          ruleId: 'remote-nodes:no-ip-transport',
        });
      }
    }

    return diagnostics;
  },
};
