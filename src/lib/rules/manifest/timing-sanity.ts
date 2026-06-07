import type { Manifest } from "@core";
import type { BoardDef } from "@core";
import type { ManifestRule, RuleDiagnostic } from "../rule.types";

export const timingSanity: ManifestRule = {
  id: "timing-sanity",
  name: "Timing parameter sanity",

  evaluate(m: Manifest, _board: BoardDef): RuleDiagnostic[] {
    const diagnostics: RuleDiagnostic[] = [];

    if (m.timing.flow_watchdog <= m.timing.flow_confirm) {
      diagnostics.push({
        severity: "error",
        message: `flow_watchdog (${m.timing.flow_watchdog}s) must be greater than flow_confirm (${m.timing.flow_confirm}s)`,
        ruleId: this.id,
      });
    }

    return diagnostics;
  },
};
