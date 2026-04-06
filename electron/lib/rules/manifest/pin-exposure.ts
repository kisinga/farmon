import type { Manifest } from "../../schema.js";
import type { BoardDef } from "../../board.js";
import { reservedPins, exposedPins } from "../../board.js";
import type { ManifestRule, RuleDiagnostic } from "../rule.types.js";
import { collectAllPins } from "./pin-utils.js";

export const pinExposure: ManifestRule = {
  id: "pin-exposure",
  name: "Pin not on board headers",

  evaluate(m: Manifest, board: BoardDef): RuleDiagnostic[] {
    const diagnostics: RuleDiagnostic[] = [];
    const reserved = reservedPins(board);
    const exposed = exposedPins(board);
    const allPins = collectAllPins(m);

    for (const { pin, owner, nodeId } of allPins) {
      if (!exposed.has(pin) && !reserved.has(pin)) {
        diagnostics.push({
          severity: "warning",
          message: `Pin ${pin} used by ${owner} is not on ${board.label} headers`,
          target: nodeId,
          ruleId: this.id,
        });
      }
    }

    return diagnostics;
  },
};
