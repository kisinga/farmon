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
import { resolveComponentHeader } from './io-providers/resolve-channel';
import { deriveTankCalibration, recommendSensorMaxPsi } from './units';
import type { CodegenContext } from './entity-registry';

// ---------------------------------------------------------------------------
// Schema — reusable shape for both TankNode (flat fields) and PressureSensorNode
// ---------------------------------------------------------------------------

export const PressureSensorConfigSchema = z.object({
  pin: GpioPin,
  /** Vertical drop from tank outlet to sensor, metres. */
  elevation_m: z.number().nonnegative().default(0),
  /** Sensor full-scale rating, psi. */
  sensor_max_psi: z.number().positive(),
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
  node: { id: string; name: string; pin: string },
  ctx: CodegenContext,
): string {
  const ids = getPressureSensorIds(node);
  const names = pressureSensorHaNames(node);
  const header = resolveComponentHeader(ctx, node.pin, { purpose: 'adc' });
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
        return r_min + (x / 3.3f) * (r_max - r_min);

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

export function evaluatePressureSensorElevatedLowResolution(
  nodes: Array<{ id: string; name: string; sensor_max_psi: number; elevation_m?: number; tank_height_m?: number }>,
): PressureValidationIssue[] {
  return nodes
    .filter(n => typeof n.tank_height_m === 'number')
    .flatMap(n => {
      const tankHeight = n.tank_height_m!;
      const elevation = n.elevation_m ?? 0;
      if (tankHeight <= 0 || elevation <= 0 || n.sensor_max_psi <= 0) return [];
      const cal = deriveTankCalibration(tankHeight, elevation);
      const recommended = recommendSensorMaxPsi(cal.p_full_psi);
      if (n.sensor_max_psi < recommended) return [];
      const spanPct = (cal.working_span_psi / n.sensor_max_psi) * 100;
      if (spanPct < POOR_PRESSURE_SPAN_PCT) {
        return [{
          message: `Pressure sensor "${n.name}": tank level uses only ${spanPct.toFixed(0)}% of the ${n.sensor_max_psi} psi sensor range because empty pressure starts at ${cal.p_empty_psi.toFixed(2)} psi. Resolution may be poor on this elevated tank. Prefer reducing static head at the sensing point, using a lower-range protected sensor, or adding a pressure reducing/regulating arrangement that preserves the tank-level pressure swing.`,
          target: n.id,
        }];
      }
      return [];
    });
}
