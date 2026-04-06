import type { Manifest } from "../../schema.js";
import type { BoardDef } from "../../board.js";
import type { ManifestRule, RuleDiagnostic } from "../rule.types.js";

export const routeNames: ManifestRule = {
  id: "route-names",
  name: "Route name uniqueness",

  evaluate(m: Manifest, _board: BoardDef): RuleDiagnostic[] {
    const diagnostics: RuleDiagnostic[] = [];

    const nameCounts = new Map<string, number>();
    for (const route of m.routes) {
      nameCounts.set(route.name, (nameCounts.get(route.name) ?? 0) + 1);
    }
    for (const [name, count] of nameCounts) {
      if (count > 1) {
        diagnostics.push({
          severity: "error",
          message: `Duplicate route name: "${name}"`,
          target: name,
          ruleId: this.id,
        });
      }
    }

    return diagnostics;
  },
};
