import type { Manifest } from "../../schema.js";
import type { BoardDef } from "../../board.js";
import type { ManifestRule, RuleDiagnostic } from "../rule.types.js";

const MAX_VALVE_MASK_BITS = 16; // uint16_t

export const valveMaskOverflow: ManifestRule = {
  id: "valve-mask-overflow",
  name: "Valve mask overflow",

  evaluate(m: Manifest, _board: BoardDef): RuleDiagnostic[] {
    const diagnostics: RuleDiagnostic[] = [];

    if (m.valves.length > MAX_VALVE_MASK_BITS) {
      diagnostics.push({
        severity: "error",
        message: `${m.valves.length} valves exceeds valve_mask capacity (uint16_t max ${MAX_VALVE_MASK_BITS}). ` +
          `Split across multiple controllers.`,
        ruleId: this.id,
      });
    }

    const valveIndexMap = new Map(m.valves.map((v, i) => [v.id, i]));
    for (const route of m.routes) {
      for (const v of route.valves) {
        const idx = valveIndexMap.get(v);
        if (idx !== undefined && idx >= MAX_VALVE_MASK_BITS) {
          diagnostics.push({
            severity: "error",
            message: `Route "${route.name}": valve "${v}" at index ${idx} overflows uint16_t valve_mask.`,
            target: route.name,
            ruleId: this.id,
          });
        }
      }
    }

    return diagnostics;
  },
};
