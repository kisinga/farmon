/**
 * Shared pressure-sensor schema, codegen, and validation helpers.
 *
 * Consumed by both:
 *   - Tank descriptor (intrinsic tank-mounted pressure monitoring)
 *   - PressureSensor descriptor (inline line-pressure monitoring)
 *
 * Keeping the logic in one place guarantees that tank-mounted and inline
 * pressure sensors emit identical YAML and obey identical calibration rules.
 */

import { z } from 'zod';
import { GpioPin } from './schemas';
import {
  pressureSensorId,
  pressureSensorCalEmptyId,
  pressureSensorCalFullId,
  pressureSensorLevelId,
} from './codegen-ids';
import { formatComponentHeader } from './io-providers/resolve-channel';
import { deriveTankCalibration, recommendSensorMaxPsi } from './units';
import type { CodegenContext } from './entity-registry';

/**
 * ESP32 ADC full-scale *reading* at 12db attenuation — volts at the pin. The
 * board's analog front-end maps its input range (`PinDef.adc_full_scale_v`) onto
 * this, so the sensor lambda's `x` runs 0..ADC_PIN_REF_V.
 */
export const ADC_PIN_REF_V = 3.3;

/** A C++ float literal — always carries a decimal point and an `f` suffix. */
function cppFloatLiteral(v: number): string {
  const s = v.toFixed(4).replace(/0+$/, '').replace(/\.$/, '.0');
  return `${s.includes('.') ? s : `${s}.0`}f`;
}

/**
 * The pin voltages at the sensor's output extremes — the two anchors the codegen
 * bakes into the linear voltage→pressure map. The board maps its input range onto
 * ADC_PIN_REF_V, so a sensor output of `v` lands at `v * ADC_PIN_REF_V / range` at
 * the pin. `vMax` defaults to the board range (sensor swings the whole input); a
 * non-zero `vMin` handles offset sensors (e.g. 0.5-4.5V ratiometric).
 */
function adcPinAnchors(boardAdcRangeV: number, vMin: number, vMax?: number | null): { lo: number; hi: number } {
  const range = boardAdcRangeV > 0 ? boardAdcRangeV : ADC_PIN_REF_V;
  const k = ADC_PIN_REF_V / range;
  return { lo: vMin * k, hi: (vMax ?? range) * k };
}

// ---------------------------------------------------------------------------
// Schema — reusable shape for both TankNode (flat fields) and PressureSensorNode
// ---------------------------------------------------------------------------

export const PressureSensorConfigSchema = z.object({
  pin: GpioPin,
  /** Vertical drop from tank outlet to sensor, metres. */
  elevation_m: z.number().nonnegative().default(0),
  /** Sensor full-scale rating, psi (datasheet). The 0..max range is baked. */
  sensor_max_psi: z.number().positive(),
  /** Sensor output voltage at 0 psi (datasheet). 0 for a 0-Vmax sensor; e.g. 0.5
   *  for a 0.5-4.5V ratiometric one. */
  v_min: z.number().nonnegative().default(0),
  /** Sensor output voltage at full scale (datasheet). Defaults to the board's
   *  analog input range — i.e. the sensor swings the whole input. Enter the real
   *  value (e.g. 3.3) when it's lower; the board's ADC range does the conversion. */
  v_max: z.number().positive().optional(),
  /** True if rated for reliable readings during pump operation. */
  pump_rated: z.boolean().default(false),
});

export type PressureSensorConfig = z.infer<typeof PressureSensorConfigSchema>;

// ---------------------------------------------------------------------------
// Codegen IDs
// ---------------------------------------------------------------------------

export interface PressureSensorCodegenIds {
  sId: string;
  levelId: string;
  calEmpty: string;
  calFull: string;
}

export function getPressureSensorIds(node: { id: string }): PressureSensorCodegenIds {
  return {
    sId: pressureSensorId(node),
    levelId: pressureSensorLevelId(node),
    calEmpty: pressureSensorCalEmptyId(node),
    calFull: pressureSensorCalFullId(node),
  };
}

// ---------------------------------------------------------------------------
// HA names
// ---------------------------------------------------------------------------

export interface PressureSensorHaNames {
  pressure: string;
  calEmpty: string;
  calFull: string;
  level: string;
}

export function pressureSensorHaNames(node: { name: string }): PressureSensorHaNames {
  return {
    pressure: `${node.name} Pressure`,
    calEmpty: `${node.name} Cal Empty (psi)`,
    calFull: `${node.name} Cal Full (psi)`,
    level: `${node.name} Level`,
  };
}

// ---------------------------------------------------------------------------
// YAML emit — ADC sensor + level % template
// ---------------------------------------------------------------------------

export function emitPressureSensorYaml(
  node: { id: string; name: string; pin: string; sensor_max_psi: number; v_min?: number | null; v_max?: number | null },
  ctx: CodegenContext,
): string {
  const ids = getPressureSensorIds(node);
  const names = pressureSensorHaNames(node);
  const ch = ctx.resolveChannel(node.pin, { purpose: 'adc' });
  const header = formatComponentHeader(ch);
  // Voltage→pressure is baked at design time: sensor psi range is a datasheet
  // constant (0..max), and the pin anchors come from the board's input range and
  // the sensor's v_min/v_max. All literals — no runtime range entities. The
  // dashboard's cal_empty/cal_full is the only live trim (a second linear fit).
  const { lo, hi } = adcPinAnchors(ch.adcFullScaleV ?? ADC_PIN_REF_V, node.v_min ?? 0, node.v_max);
  const span = hi - lo > 0 ? hi - lo : ADC_PIN_REF_V;
  const xLo = cppFloatLiteral(lo);
  const spanLit = cppFloatLiteral(span);
  const maxPsi = cppFloatLiteral(node.sensor_max_psi);
  return `\
${header}
  id: ${ids.sId}
  name: "${names.pressure}"
  unit_of_measurement: "psi"
  icon: "mdi:gauge"
  update_interval: \${update_interval}
  accuracy_decimals: 2
  filters:
    - median:
        window_size: 5
        send_every: 1
    - sliding_window_moving_average:
        window_size: 5
        send_every: 1
    - lambda: |-
        return ((x - ${xLo}) / ${spanLit}) * ${maxPsi};

- platform: template
  id: ${ids.levelId}
  name: "${names.level}"
  unit_of_measurement: "%"
  icon: "mdi:storage-tank"
  update_interval: \${update_interval}
  accuracy_decimals: 1
  lambda: |-
      float p   = id(${ids.sId}).state;
      float p_e = id(${ids.calEmpty}).state;
      float p_f = id(${ids.calFull}).state;
      if (std::isnan(p) || std::isnan(p_e) || std::isnan(p_f) || p_f <= p_e) return {};
      float pct = (p - p_e) / (p_f - p_e) * 100.0f;
      return clamp(pct, 0.0f, 100.0f);`;
}

// ---------------------------------------------------------------------------
// YAML emit — field calibration entities (calEmpty, calFull). The sensor's psi
// range is baked (datasheet constant), so only the two field-cal anchors are live.
// ---------------------------------------------------------------------------

export function emitPressureCalNumbers(
  node: { id: string; name: string; sensor_max_psi: number; elevation_m?: number | null },
  tankHeightM: number | undefined,
): Record<string, string> {
  const ids = getPressureSensorIds(node);
  const names = pressureSensorHaNames(node);
  const cal = tankHeightM != null
    ? deriveTankCalibration(tankHeightM, node.elevation_m ?? 0)
    : { p_empty_psi: 0, p_full_psi: node.sensor_max_psi, working_span_psi: node.sensor_max_psi };
  const fmt = (v: number) => v.toFixed(2);
  return {
    number: `\
- platform: template
  name: "${names.calEmpty}"
  id: ${ids.calEmpty}
  icon: "mdi:tune-vertical"
  min_value: 0
  max_value: 200
  step: 0.1
  initial_value: ${fmt(cal.p_empty_psi)}
  optimistic: true
  entity_category: config

- platform: template
  name: "${names.calFull}"
  id: ${ids.calFull}
  icon: "mdi:tune-vertical"
  min_value: 0
  max_value: 200
  step: 0.1
  initial_value: ${fmt(cal.p_full_psi)}
  optimistic: true
  entity_category: config`,
  };
}

// ---------------------------------------------------------------------------
// Validation helpers
// ---------------------------------------------------------------------------

export interface PressureValidationIssue {
  message: string;
  target: string;
}

export function evaluatePressureSensorUndersized(
  nodes: Array<{ id: string; name: string; sensor_max_psi: number; elevation_m?: number; tank_height_m?: number }>,
): PressureValidationIssue[] {
  return nodes
    .filter(n => typeof n.tank_height_m === 'number')
    .flatMap(n => {
      const cal = deriveTankCalibration(n.tank_height_m!, n.elevation_m ?? 0);
      const recommended = recommendSensorMaxPsi(cal.p_full_psi);
      if (n.sensor_max_psi < recommended) {
        return [{
          message: `Pressure sensor "${n.name}": ${n.sensor_max_psi} psi is below the recommended ${recommended} psi (1.5× full-tank pressure of ${cal.p_full_psi.toFixed(2)} psi). Consider a larger sensor for headroom.`,
          target: n.id,
        }];
      }
      return [];
    });
}

const POOR_PRESSURE_SPAN_PCT = 15;

/**
 * Low usable resolution — how much of the sensor's pressure range the tank's
 * empty→full swing exercises. Sensor noise and accuracy are rated against full
 * scale, so a tank that swings a tiny slice of a big sensor reads near the noise.
 * Voltage is deliberately NOT a factor: the ADC has far more steps than a tank
 * level needs, so voltage utilisation never limits in practice. Skips undersized
 * sensors (the undersized rule owns those).
 */
export function evaluatePressureSensorLowResolution(
  nodes: Array<{ id: string; name: string; sensor_max_psi: number; elevation_m?: number; tank_height_m?: number }>,
): PressureValidationIssue[] {
  return nodes
    .filter(n => typeof n.tank_height_m === 'number')
    .flatMap(n => {
      const tankHeight = n.tank_height_m!;
      if (tankHeight <= 0 || n.sensor_max_psi <= 0) return [];
      const cal = deriveTankCalibration(tankHeight, n.elevation_m ?? 0);
      const recommended = recommendSensorMaxPsi(cal.p_full_psi);
      if (n.sensor_max_psi < recommended) return []; // undersized rule owns this
      const spanPct = (cal.working_span_psi / n.sensor_max_psi) * 100;
      if (spanPct >= POOR_PRESSURE_SPAN_PCT) return [];
      const headTip = (n.elevation_m ?? 0) > 0 ? ' (high static head eats the range)' : '';
      return [{
        message: `Pressure sensor "${n.name}": the tank level swings only ${spanPct.toFixed(0)}% of the ${n.sensor_max_psi} psi sensor range${headTip}, so the reading sits near the sensor's noise floor. Use a closer-ranged sensor for finer level resolution.`,
        target: n.id,
      }];
    });
}

/**
 * Sensor full-scale output voltage exceeding the board's analog input range — it
 * would clip at full scale (or damage a bare ESP32 pin). An error, not a warning.
 */
export function evaluatePressureSensorOverRange(
  nodes: Array<{ id: string; name: string; v_max?: number | null; board_adc_range_v: number }>,
): PressureValidationIssue[] {
  return nodes.flatMap(n => {
    if (typeof n.v_max !== 'number' || n.board_adc_range_v <= 0) return [];
    if (n.v_max <= n.board_adc_range_v) return [];
    return [{
      message: `Pressure sensor "${n.name}": ${n.v_max}V full-scale output exceeds the board's ${n.board_adc_range_v}V analog input range — readings clip at full scale. Use a sensor within the input range, or condition the signal down.`,
      target: n.id,
    }];
  });
}
