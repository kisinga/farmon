import type { Manifest } from "../../schema.js";
import type { BoardDef } from "../../board.js";
import { exposedPins } from "../../board.js";
import type { ManifestRule, RuleDiagnostic } from "../rule.types.js";
import { collectAllPins } from "./pin-utils.js";

export interface GpioBudgetOptions {
  /** When true, GPIO budget overruns are warnings instead of errors. */
  loose?: boolean;
}

export const gpioBudget: ManifestRule & { options?: GpioBudgetOptions } = {
  id: "gpio-budget",
  name: "GPIO budget",

  evaluate(m: Manifest, board: BoardDef): RuleDiagnostic[] {
    const diagnostics: RuleDiagnostic[] = [];
    const loose = this.options?.loose ?? false;
    const allPins = collectAllPins(m);
    const exposed = exposedPins(board);
    const uniquePins = new Set(allPins.map((p) => p.pin));
    const maxPins = exposed.size;

    if (uniquePins.size > maxPins) {
      const msg = `${uniquePins.size} GPIOs used — ${board.label} has ${maxPins} exposed pins.`;
      if (loose) {
        diagnostics.push({
          severity: "warning",
          message: `${msg} Running in --loose mode, continuing anyway.`,
          ruleId: this.id,
        });
      } else {
        diagnostics.push({
          severity: "error",
          message: `${msg} If using I2C expanders, re-run with --loose to bypass this check.`,
          ruleId: this.id,
        });
      }
    }

    return diagnostics;
  },
};
