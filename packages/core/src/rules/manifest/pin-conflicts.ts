import type { Manifest } from "@far-mon/core";
import type { BoardDef } from "@far-mon/core";
import type { ManifestRule, RuleDiagnostic } from "../rule.types";
import { collectAllPins } from "./pin-utils";

export const pinConflicts: ManifestRule = {
  id: "pin-conflicts",
  name: "Duplicate pin usage",

  evaluate(m: Manifest, _board: BoardDef): RuleDiagnostic[] {
    const diagnostics: RuleDiagnostic[] = [];
    const allPins = collectAllPins(m);
    const seen = new Map<string, { owner: string; nodeId: string }>();

    for (const { pin, owner, nodeId } of allPins) {
      const existing = seen.get(pin);
      if (existing) {
        diagnostics.push({
          severity: "error",
          message: `Pin ${pin} used by both ${existing.owner} and ${owner}`,
          target: nodeId,
          ruleId: this.id,
        });
      } else {
        seen.set(pin, { owner, nodeId });
      }
    }

    return diagnostics;
  },
};
