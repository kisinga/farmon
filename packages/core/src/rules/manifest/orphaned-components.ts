import type { Manifest } from "@far-mon/core";
import { nodesByKind } from "@far-mon/core";
import type { BoardDef } from "@far-mon/core";
import type { ManifestRule, RuleDiagnostic } from "../rule.types";

export const orphanedComponents: ManifestRule = {
  id: "orphaned-components",
  name: "Unused components",

  evaluate(m: Manifest, _board: BoardDef): RuleDiagnostic[] {
    const diagnostics: RuleDiagnostic[] = [];

    const usedValves = new Set(m.routes.flatMap((r) => r.valves));
    for (const v of nodesByKind(m.nodes, 'valve')) {
      if (!usedValves.has(String(v['id']))) {
        diagnostics.push({
          severity: "warning",
          message: `Valve "${v['id']}" defined but not used in any route`,
          target: String(v['id']),
          ruleId: this.id,
        });
      }
    }

    const usedFlows = new Set(m.routes.map((r) => r.flow_sensor).filter(Boolean));
    for (const f of nodesByKind(m.nodes, 'flow_sensor')) {
      if (!usedFlows.has(String(f['id']))) {
        diagnostics.push({
          severity: "warning",
          message: `Flow sensor "${f['id']}" defined but not used in any route`,
          target: String(f['id']),
          ruleId: this.id,
        });
      }
    }

    return diagnostics;
  },
};
