import type { Manifest, BoardDef } from "@core";
import { evaluatePressureSensorLowResolution, evaluatePressureSensorOverRange, ADC_PIN_REF_V } from "@core";
import type { ManifestRule, RuleDiagnostic } from "../rule.types";

/**
 * Effective pressure-sensor resolution — board-aware.
 *
 * A tank's level resolution is the product of two factors: how much of the
 * sensor's psi range the tank's empty→full swing uses, and how much of the
 * board's ADC input range the sensor's output voltage reaches. The board owns
 * the ADC range (`PinDef.adc_full_scale_v`), so this lives as a manifest rule —
 * the only rule family with the board in scope. A 0-3.3V sensor on the 0-5V
 * KC868-A16 terminal loses a third of the ADC range before the psi factor even
 * applies; this rule is what makes that visible.
 */
export const pressureResolution: ManifestRule = {
  id: "pressure-resolution",
  name: "Pressure-sensor effective resolution",

  evaluate(m: Manifest, board: BoardDef): RuleDiagnostic[] {
    // Board ADC pins only; provider/expander ADC channels (e.g. `mux1:CH3`) miss
    // board.pins and assume 3.3 — matching the codegen divisor's default.
    const adcRange = (pin: string): number =>
      board.pins.find(p => p.gpio === pin || p.connector === pin)?.adc_full_scale_v ?? ADC_PIN_REF_V;

    const candidates = m.nodes
      .filter(n => n.kind === 'tank' && n['level_monitored'] === true)
      .flatMap(n => {
        const pin = n['pressure_pin'];
        const maxPsi = n['pressure_sensor_max_psi'];
        const height = n['height_m'];
        if (typeof pin !== 'string' || !pin || typeof maxPsi !== 'number' || typeof height !== 'number') return [];
        const elevation = n['pressure_elevation_m'];
        const vMax = n['pressure_v_max'];
        return [{
          id: n.id,
          name: n.name,
          sensor_max_psi: maxPsi,
          tank_height_m: height,
          elevation_m: typeof elevation === 'number' ? elevation : undefined,
          v_max: typeof vMax === 'number' ? vMax : undefined,
          board_adc_range_v: adcRange(pin),
        }];
      });

    return [
      ...evaluatePressureSensorOverRange(candidates).map((issue): RuleDiagnostic => ({
        severity: 'error', message: issue.message, target: issue.target, ruleId: 'pressure-resolution',
      })),
      ...evaluatePressureSensorLowResolution(candidates).map((issue): RuleDiagnostic => ({
        severity: 'warning', message: issue.message, target: issue.target, ruleId: 'pressure-resolution',
      })),
    ];
  },
};
