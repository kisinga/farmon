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
  pressureSensorRangeMinId,
  pressureSensorRangeMaxId,
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
 * Pin voltage at full sensor output — the divisor that maps the ADC reading onto
 * the sensor's range. Combines the board's analog input range with the sensor's
 * own full-scale output (defaulting to that range). A 0-3.3V sensor on a 0-5V
 * input therefore tops out at 3.3 * 3.3/5 = 2.18V at the pin.
 */
function adcDivisorVolts(boardAdcRangeV: number, sensorOutputV?: number | null): number {
  const range = boardAdcRangeV > 0 ? boardAdcRangeV : ADC_PIN_REF_V;
  const sensorV = sensorOutputV ?? range;
  return sensorV * ADC_PIN_REF_V / range;
}

// ---------------------------------------------------------------------------
// Schema — reusable shape for both TankNode (flat fields) and PressureSensorNode
// ---------------------------------------------------------------------------

export const PressureSensorConfigSchema = z.object({
  pin: GpioPin,
  /** Vertical drop from tank outlet to sensor, metres. */
  elevation_m: z.number().nonnegative().default(0),
  /** Sensor full-scale rating, psi. */
  sensor_max_psi: z.number().positive(),
  /**
   * Sensor's full-scale output voltage (datasheet). Defaults to the board's
   * analog input range — i.e. the sensor swings the whole input range. Set the
   * sensor's real value when it is lower than the input range (e.g. a 0-3.3V
   * sensor on the KC868-A16's 0-5V terminal): scaling and resolution are then
   * derived from the board's ADC range, so you enter 3.3 — never the pin voltage.
   */
  sensor_output_v: z.number().positive().optional(),
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
  rangeMin: string;
  rangeMax: string;
  calEmpty: string;
  calFull: string;
}

export function getPressureSensorIds(node: { id: string }): PressureSensorCodegenIds {
  return {
    sId: pressureSensorId(node),
    levelId: pressureSensorLevelId(node),
    rangeMin: pressureSensorRangeMinId(node),
    rangeMax: pressureSensorRangeMaxId(node),
    calEmpty: pressureSensorCalEmptyId(node),
    calFull: pressureSensorCalFullId(node),
  };
}

// ---------------------------------------------------------------------------
// HA names
// ---------------------------------------------------------------------------

export interface PressureSensorHaNames {
  pressure: string;
  rangeMin: string;
  rangeMax: string;
  calEmpty: string;
  calFull: string;
  level: string;
}

export function pressureSensorHaNames(node: { name: string }): PressureSensorHaNames {
  return {
    pressure: `${node.name} Pressure`,
    rangeMin: `${node.name} Sensor Min (psi)`,
    rangeMax: `${node.name} Sensor Max (psi)`,
    calEmpty: `${node.name} Cal Empty (psi)`,
    calFull: `${node.name} Cal Full (psi)`,
    level: `${node.name} Level`,
  };
}

// ---------------------------------------------------------------------------
// YAML emit — ADC sensor + level % template
// ---------------------------------------------------------------------------

export function emitPressureSensorYaml(
  node: { id: string; name: string; pin: string; sensor_output_v?: number | null },
  ctx: CodegenContext,
): string {
  const ids = getPressureSensorIds(node);
  const names = pressureSensorHaNames(node);
  const ch = ctx.resolveChannel(node.pin, { purpose: 'adc' });
  const header = formatComponentHeader(ch);
  // Divisor baked at design time: the board declares its analog input range; the
  // sensor declares its own full-scale output (default = that range). Fixed by
  // hardware, so a literal — never a runtime entity.
  const divisor = cppFloatLiteral(adcDivisorVolts(ch.adcFullScaleV ?? ADC_PIN_REF_V, node.sensor_output_v));
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
        float r_min = id(${ids.rangeMin}).state;
        float r_max = id(${ids.rangeMax}).state;
        if (std::isnan(r_min) || std::isnan(r_max) || r_max <= r_min) return x;
        return r_min + (x / ${divisor}) * (r_max - r_min);

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
// YAML emit — calibration number entities (rangeMin, rangeMax, calEmpty, calFull)
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
  name: "${names.rangeMin}"
  id: ${ids.rangeMin}
  icon: "mdi:tune-vertical"
  min_value: 0
  max_value: 200
  step: 0.1
  initial_value: 0
  optimistic: true
  restore_value: true
  entity_category: config

- platform: template
  name: "${names.rangeMax}"
  id: ${ids.rangeMax}
  icon: "mdi:tune-vertical"
  min_value: 0
  max_value: 200
  step: 0.1
  initial_value: ${node.sensor_max_psi}
  optimistic: true
  restore_value: true
  entity_category: config

- platform: template
  name: "${names.calEmpty}"
  id: ${ids.calEmpty}
  icon: "mdi:tune-vertical"
  min_value: 0
  max_value: 200
  step: 0.1
  initial_value: ${fmt(cal.p_empty_psi)}
  optimistic: true
  restore_value: true
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
  restore_value: true
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
 * Low *effective* resolution — the product of the two factors that shrink how
 * much of the ADC the tank's empty→full swing actually exercises:
 *   - psi utilisation  = tank working span / sensor psi range
 *   - voltage utilisation = sensor full output / board ADC input range
 * Either alone can look fine; their product is the real resolution. Skips simply
 * undersized sensors (the undersized rule owns those). Board-aware, so it lives
 * behind a manifest rule where the board (and thus the ADC range) is in scope.
 */
export function evaluatePressureSensorLowResolution(
  nodes: Array<{
    id: string; name: string; sensor_max_psi: number;
    elevation_m?: number; tank_height_m?: number;
    sensor_output_v?: number | null; board_adc_range_v: number;
  }>,
): PressureValidationIssue[] {
  return nodes
    .filter(n => typeof n.tank_height_m === 'number')
    .flatMap(n => {
      const tankHeight = n.tank_height_m!;
      if (tankHeight <= 0 || n.sensor_max_psi <= 0 || n.board_adc_range_v <= 0) return [];
      const cal = deriveTankCalibration(tankHeight, n.elevation_m ?? 0);
      const recommended = recommendSensorMaxPsi(cal.p_full_psi);
      if (n.sensor_max_psi < recommended) return []; // undersized rule owns this
      const psiUtil = cal.working_span_psi / n.sensor_max_psi;
      const sensorV = n.sensor_output_v ?? n.board_adc_range_v;
      const voltUtil = Math.min(1, sensorV / n.board_adc_range_v);
      const effectivePct = psiUtil * voltUtil * 100;
      if (effectivePct >= POOR_PRESSURE_SPAN_PCT) return [];
      const headTip = (n.elevation_m ?? 0) > 0 ? 'lower the static head, ' : '';
      return [{
        message: `Pressure sensor "${n.name}": tank level uses only ${effectivePct.toFixed(0)}% of the sensor's resolution — the level swing spans ${(psiUtil * 100).toFixed(0)}% of the ${n.sensor_max_psi} psi sensor, and the sensor reaches ${(voltUtil * 100).toFixed(0)}% of the board's ${n.board_adc_range_v}V input. Use a closer-ranged sensor, ${headTip}or match the sensor output to the board input for finer readings.`,
        target: n.id,
      }];
    });
}

/**
 * Sensor output voltage exceeding the board's analog input range — the sensor
 * would clip at full scale (or damage a bare ESP32 pin). An error, not a warning.
 */
export function evaluatePressureSensorOverRange(
  nodes: Array<{ id: string; name: string; sensor_output_v?: number | null; board_adc_range_v: number }>,
): PressureValidationIssue[] {
  return nodes.flatMap(n => {
    if (typeof n.sensor_output_v !== 'number' || n.board_adc_range_v <= 0) return [];
    if (n.sensor_output_v <= n.board_adc_range_v) return [];
    return [{
      message: `Pressure sensor "${n.name}": ${n.sensor_output_v}V full-scale output exceeds the board's ${n.board_adc_range_v}V analog input range — readings clip at full scale. Use a sensor within the input range, or condition the signal down.`,
      target: n.id,
    }];
  });
}
