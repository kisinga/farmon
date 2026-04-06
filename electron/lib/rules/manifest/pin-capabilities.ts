import type { Manifest } from "../../schema.js";
import type { BoardDef } from "../../board.js";
import { pinsWithCapability } from "../../board.js";
import type { ManifestRule, RuleDiagnostic } from "../rule.types.js";

export const pinCapabilities: ManifestRule = {
  id: "pin-capabilities",
  name: "Pin capability checks",

  evaluate(m: Manifest, board: BoardDef): RuleDiagnostic[] {
    const diagnostics: RuleDiagnostic[] = [];
    const adcPins = pinsWithCapability(board, "adc");
    const pcntPins = pinsWithCapability(board, "pulse_counter");

    // Tank level pins must have ADC
    for (const tank of m.tanks) {
      if (tank.level_pin && !adcPins.has(tank.level_pin)) {
        diagnostics.push({
          severity: "error",
          message: `Tank "${tank.id}": ${tank.level_pin} does not have ADC capability on ${board.label}`,
          target: tank.id,
          ruleId: this.id,
        });
      }
    }

    // Water source pressure pins must have ADC
    for (const ws of m.water_sources) {
      if (ws.pressure_pin && !adcPins.has(ws.pressure_pin)) {
        diagnostics.push({
          severity: "error",
          message: `Water source "${ws.id}": ${ws.pressure_pin} does not have ADC capability on ${board.label}`,
          target: ws.id,
          ruleId: this.id,
        });
      }
    }

    // Flow sensor pins should have pulse_counter
    for (const flow of m.flow_sensors) {
      if (!pcntPins.has(flow.pin)) {
        diagnostics.push({
          severity: "warning",
          message: `Flow "${flow.id}": ${flow.pin} does not have pulse_counter capability on ${board.label}. ` +
            `Software counting may miss pulses at high flow rates.`,
          target: flow.id,
          ruleId: this.id,
        });
      }
      if (flow.flow_cal <= 0) {
        diagnostics.push({
          severity: "error",
          message: `Flow "${flow.id}": flow_cal must be > 0 (got ${flow.flow_cal})`,
          target: flow.id,
          ruleId: this.id,
        });
      }
    }

    return diagnostics;
  },
};
