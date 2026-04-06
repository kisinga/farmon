import type { Manifest } from "../../schema.js";
import type { BoardDef } from "../../board.js";
import type { ManifestRule, RuleDiagnostic } from "../rule.types.js";

export const orphanedComponents: ManifestRule = {
  id: "orphaned-components",
  name: "Unused components",

  evaluate(m: Manifest, _board: BoardDef): RuleDiagnostic[] {
    const diagnostics: RuleDiagnostic[] = [];

    const usedValves = new Set(m.routes.flatMap((r) => r.valves));
    for (const v of m.valves) {
      if (!usedValves.has(v.id)) {
        diagnostics.push({
          severity: "warning",
          message: `Valve "${v.id}" defined but not used in any route`,
          target: v.id,
          ruleId: this.id,
        });
      }
    }

    const usedFlows = new Set(m.routes.map((r) => r.flow_sensor));
    for (const f of m.flow_sensors) {
      if (!usedFlows.has(f.id)) {
        diagnostics.push({
          severity: "warning",
          message: `Flow sensor "${f.id}" defined but not used in any route`,
          target: f.id,
          ruleId: this.id,
        });
      }
    }

    return diagnostics;
  },
};
