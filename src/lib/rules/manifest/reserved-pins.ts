import type { Manifest } from "@core";
import type { BoardDef } from "@core";
import { reservedPins } from "@core";
import type { ManifestRule, RuleDiagnostic } from "../rule.types";
import { collectAllPins } from "./pin-utils";

export const reservedPinsRule: ManifestRule = {
  id: "reserved-pins",
  name: "Reserved pin usage",

  evaluate(m: Manifest, board: BoardDef): RuleDiagnostic[] {
    const diagnostics: RuleDiagnostic[] = [];
    const reserved = reservedPins(board);
    const allPins = collectAllPins(m);

    for (const { pin, owner, nodeId } of allPins) {
      const reason = reserved.get(pin);
      if (reason) {
        diagnostics.push({
          severity: "error",
          message: `Pin ${pin} used by ${owner} is reserved for ${reason} on ${board.label}`,
          target: nodeId,
          ruleId: this.id,
        });
      }
    }

    return diagnostics;
  },
};
