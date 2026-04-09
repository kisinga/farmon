import type { Manifest } from "../../schema.js";
import type { BoardDef } from "../../board.js";
import { pinsWithCapability } from "../../board.js";
import type { ManifestRule, RuleDiagnostic } from "../rule.types.js";
import { NODE_REGISTRY } from '@far-mon/core';

export const pinCapabilities: ManifestRule = {
  id: "pin-capabilities",
  name: "Pin capability checks",

  evaluate(m: Manifest, board: BoardDef): RuleDiagnostic[] {
    const diagnostics: RuleDiagnostic[] = [];

    // Cache capability lookups
    const capCache = new Map<string, Set<string>>();
    const getPins = (cap: string) => {
      if (!capCache.has(cap)) capCache.set(cap, pinsWithCapability(board, cap as any));
      return capCache.get(cap)!;
    };

    // Check every node's pin fields against required capabilities
    for (const node of m.nodes) {
      const desc = NODE_REGISTRY.get(node['kind']);
      if (!desc) continue;

      for (const field of desc.sidebarFields) {
        if (field.type !== 'pin' || !field.pinCap) continue;
        const pin = node[field.key];
        if (typeof pin !== 'string' || !pin) continue;

        const validPins = getPins(field.pinCap);
        if (!validPins.has(pin)) {
          diagnostics.push({
            severity: field.pinCap === 'pulse_counter' ? 'warning' : 'error',
            message: `${desc.label} "${node['id']}": ${pin} does not have ${field.pinCap} capability on ${board.label}`,
            target: String(node['id']),
            ruleId: this.id,
          });
        }
      }
    }

    return diagnostics;
  },
};
