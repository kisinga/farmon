import type { Manifest } from "@core";
import type { BoardDef } from "@core";
import type { ManifestRule, RuleDiagnostic } from "../rule.types";
import { NODE_REGISTRY } from '@core';

/**
 * Ensures all pin fields on a multi-pin entity resolve to the same transport.
 * Mixing transports (e.g. GPIO + modbus) generates invalid ESPHome YAML
 * because directives like interlock and restore_mode are platform-specific.
 */
export const pinTransportConsistency: ManifestRule = {
  id: "pin-transport-consistency",
  name: "Multi-pin transport consistency",

  evaluate(m: Manifest, _board: BoardDef): RuleDiagnostic[] {
    const diagnostics: RuleDiagnostic[] = [];
    const providerTypes = new Map(
      (m.device.io_providers ?? []).map(p => [p.id, p.type]),
    );

    for (const node of m.nodes) {
      const desc = NODE_REGISTRY.get(node.kind);
      if (!desc) continue;

      const pinFields = desc.sidebarFields.filter(f => f.type === 'pin');
      if (pinFields.length < 2) continue;

      const resolved: Array<{ field: string; transport: string }> = [];
      for (const field of pinFields) {
        const value = node[field.key];
        if (typeof value !== 'string' || !value) continue;
        resolved.push({ field: field.label, transport: classifyTransport(value, providerTypes) });
      }

      if (resolved.length < 2) continue;

      const first = resolved[0].transport;
      const mismatched = resolved.filter(r => r.transport !== first);
      if (mismatched.length > 0) {
        const details = resolved.map(r => `${r.field} → ${r.transport}`).join(', ');
        diagnostics.push({
          severity: "error",
          message: `${desc.label} "${node.id}": pins use different transports (${details}). All pins must use the same transport.`,
          target: String(node.id),
          ruleId: this.id,
        });
      }
    }

    return diagnostics;
  },
};

/** Classify a pin value to its transport type. */
function classifyTransport(pin: string, providerTypes: Map<string, string>): string {
  const colonIdx = pin.indexOf(':');
  if (colonIdx > 0) {
    const providerId = pin.slice(0, colonIdx);
    return providerTypes.get(providerId) ?? 'unknown';
  }
  if (providerTypes.has(pin)) {
    return providerTypes.get(pin)!;
  }
  return 'board';
}
