import type { Manifest } from "../../schema.js";
import type { BoardDef } from "../../board.js";
import type { ManifestRule, RuleDiagnostic } from "../rule.types.js";
import { NODE_REGISTRY } from '@far-mon/core';

/**
 * Validates I/O provider references:
 * - Entity fields of type 'provider' must reference a declared io_provider
 * - Declared io_providers with no referencing entity get a warning
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

    // Check all entity 'provider' fields reference a declared provider
    for (const node of m.nodes) {
      const desc = NODE_REGISTRY.get(node['kind']);
      if (!desc) continue;
      for (const field of desc.sidebarFields) {
        if (field.type !== 'provider') continue;
        const value = node[field.key];
        if (typeof value !== 'string' || !value) continue;
        referencedProviders.add(value);
        if (!declaredProviders.has(value)) {
          diagnostics.push({
            severity: "error",
            message: `${desc.label} "${node['id']}": references unknown I/O provider "${value}"`,
            target: String(node['id']),
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
