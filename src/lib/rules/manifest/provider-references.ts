import type { Manifest } from "@core";
import type { BoardDef } from "@core";
import type { ManifestRule, RuleDiagnostic } from "../rule.types";
import { NODE_REGISTRY } from '@core';

/**
 * Validates I/O provider references:
 * - Pin fields referencing a provider (direct or provider:channel) must match a declared io_provider
 * - Declared io_providers with no referencing entity get an info hint
 */
export const providerReferences: ManifestRule = {
  id: "provider-references",
  name: "I/O provider reference integrity",

  evaluate(m: Manifest, _board: BoardDef): RuleDiagnostic[] {
    const diagnostics: RuleDiagnostic[] = [];
    const declaredProviders = new Set(
      (m.device.io_providers ?? []).map(p => p.id),
    );
    const referencedProviders = new Set<string>();

    for (const node of m.nodes) {
      const desc = NODE_REGISTRY.get(node.kind);
      if (!desc) continue;
      for (const field of desc.sidebarFields) {
        if (field.type !== 'pin') continue;
        const value = node[field.key];
        if (typeof value !== 'string' || !value) continue;

        // Extract provider ID: "vfd1_ctrl" (direct) or "mux1:CH3" (channel)
        const colonIdx = value.indexOf(':');
        const providerId = colonIdx > 0 ? value.slice(0, colonIdx) : value;

        // Skip board pins (no provider reference)
        if (!declaredProviders.has(providerId) && colonIdx <= 0) continue;

        referencedProviders.add(providerId);
        if (!declaredProviders.has(providerId)) {
          diagnostics.push({
            severity: "error",
            message: `${desc.label} "${node.id}": references unknown I/O provider "${providerId}"`,
            target: String(node.id),
            ruleId: this.id,
          });
        }
      }
    }

    // Warn about declared but unused providers
    for (const id of declaredProviders) {
      if (!referencedProviders.has(id)) {
        diagnostics.push({
          severity: "info",
          message: `I/O provider "${id}" is declared but not referenced by any entity`,
          ruleId: this.id,
        });
      }
    }

    return diagnostics;
  },
};
