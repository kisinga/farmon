import type { Manifest } from "@core";
import type { BoardDef } from "@core";
import type { ManifestRule, RuleDiagnostic } from "../rule.types";

const MAX_ROUTES = 16; // conflict_mask is uint16_t

export const routeCount: ManifestRule = {
  id: "route-count",
  name: "Route count limit",

  evaluate(m: Manifest, _board: BoardDef): RuleDiagnostic[] {
    if (m.routes.length > MAX_ROUTES) {
      return [{
        severity: "error",
        message: `${m.routes.length} routes exceeds conflict_mask capacity (uint16_t max ${MAX_ROUTES}). Split across multiple controllers.`,
        ruleId: this.id,
      }];
    }
    return [];
  },
};
