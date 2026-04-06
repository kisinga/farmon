import type { Manifest } from "../../schema.js";
import type { BoardDef } from "../../board.js";
import { reservedPins } from "../../board.js";
import type { ManifestRule, RuleDiagnostic } from "../rule.types.js";
import { collectAllPins } from "./pin-utils.js";

export const reservedPinsRule: ManifestRule = {
  id: "reserved-pins",
  name: "Reserved pin usage",

  evaluate(m: Manifest, board: BoardDef): RuleDiagnostic[] {
    const diagnostics: RuleDiagnostic[] = [];
    const reserved = reservedPins(board);
    const allPins = collectAllPins(m);

    for (const { pin, owner } of allPins) {
      const reason = reserved.get(pin);
      if (reason) {
        diagnostics.push({
          severity: "error",
          message: `Pin ${pin} used by ${owner} is reserved for ${reason} on ${board.label}`,
          ruleId: this.id,
        });
      }
    }

    return diagnostics;
  },
};
