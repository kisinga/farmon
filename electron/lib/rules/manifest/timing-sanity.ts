import type { Manifest } from "../../schema.js";
import type { BoardDef } from "../../board.js";
import type { ManifestRule, RuleDiagnostic } from "../rule.types.js";

export const timingSanity: ManifestRule = {
  id: "timing-sanity",
  name: "Timing parameter sanity",

  evaluate(m: Manifest, _board: BoardDef): RuleDiagnostic[] {
    const diagnostics: RuleDiagnostic[] = [];

    if (m.timing.flow_watchdog_seconds <= m.timing.flow_confirm_seconds) {
      diagnostics.push({
        severity: "error",
        message: `flow_watchdog_seconds (${m.timing.flow_watchdog_seconds}) must be greater than flow_confirm_seconds (${m.timing.flow_confirm_seconds})`,
        ruleId: this.id,
      });
    }

    return diagnostics;
  },
};
