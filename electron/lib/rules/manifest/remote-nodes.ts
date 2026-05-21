import type { ManifestRule, RuleDiagnostic } from "../rule.types.js";
import type { Manifest } from "../../schema.js";
import type { BoardDef } from "../../board.js";
import { boardSupportedTransports } from '@far-mon/core';

export const remoteNodes: ManifestRule = {
  id: 'remote-nodes',
  name: 'Remote node validation',
  evaluate(m: Manifest, board: BoardDef): RuleDiagnostic[] {
    const diagnostics: RuleDiagnostic[] = [];
    const hasIpTransport = boardSupportedTransports(board).includes('wifi')
      || boardSupportedTransports(board).includes('ethernet');

    for (const node of m.nodes) {
      const remote = node.remote;
      if (!remote) continue;

      if (!remote.haEntityId) {
        diagnostics.push({
          severity: 'error',
          message: `Remote node "${node.name || node.id}" references provider "${remote.providerSystemId}" which could not be resolved. Verify the provider system and node exist and export HA entities.`,
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
