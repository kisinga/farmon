import type { Manifest } from "@core";
import type { BoardDef } from "@core";
import type { ManifestRule, RuleDiagnostic } from "../rule.types";

export const routeNames: ManifestRule = {
  id: "route-names",
  name: "Route name uniqueness",

  evaluate(m: Manifest, _board: BoardDef): RuleDiagnostic[] {
    const diagnostics: RuleDiagnostic[] = [];

    const seen = new Map<string, typeof m.routes[number]>();
    for (const route of m.routes) {
      const prev = seen.get(route.name);
      if (prev) {
        diagnostics.push({
          severity: "error",
          message: `Duplicate route name: "${route.name}"`,
          target: route.key,
          ruleId: this.id,
        });
      } else {
        seen.set(route.name, route);
      }
    }

    return diagnostics;
  },
};
