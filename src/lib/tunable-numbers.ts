/**
 * Runtime-tunable device numbers — the single enumeration of every ESPHome
 * `number:` entity an operator can set at runtime via `config_set`.
 *
 * One definition, three consumers: the firmware config_set handler + value
 * publish ([codegen/generators/mqtt.ts]), the dashboard operator editors, and a
 * drift-guard test that asserts this list matches exactly the `number:` ids and
 * bounds the codegen emits — so the runtime/UI view can never silently diverge
 * from what the device actually exposes.
 *
 * Each `number:` is `entity_category: config`, `restore_value`, persisted; the
 * value publishes on set + connect (see mqtt.ts), and the dashboard reads the
 * live value from the shadow under the same id.
 */
import type { Manifest } from './manifest.types';
import { SYSTEM_ENTITY_NAMES, routeEntityNames } from './ha';
import {
  routeSourceMinNumber, routeDestMaxNumber, valveTravelTimeId,
  pressureSensorRangeMinId, pressureSensorRangeMaxId,
  pressureSensorCalEmptyId, pressureSensorCalFullId,
} from './codegen-ids';
import { pressureSensorHaNames } from './pressure-sensor-shared';
import { deriveTankCalibration } from './units';

export type TunableScope = 'controller' | 'route' | 'node';
/** `calibration` = install-time hardware commissioning (pressure-sensor anchors —
 *  safety-relevant, drives tank %; valve travel time); `tuning` = bounded
 *  operational values (timings, runtime, level setpoints). */
export type TunableTier = 'tuning' | 'calibration';
export type TunableField =
  | 'flow_watchdog' | 'flow_confirm' | 'flow_threshold' | 'claim_lease'
  | 'max_runtime' | 'source_min_pct' | 'dest_max_pct'
  | 'target_volume_l' | 'target_duration_s'
  | 'range_min' | 'range_max' | 'cal_empty' | 'cal_full'
  | 'travel_time';

/** One runtime-settable number. `key` is the ESPHome number id == the config_set
 *  key == the telemetry sensor its live value publishes under. */
export interface TunableNumber {
  key: string;
  scope: TunableScope;
  tier: TunableTier;
  field: TunableField;
  label: string;
  unit: string;
  min: number;
  max: number;
  step: number;
  /** Topology-baked initial value (UI placeholder / physical-lens seed). */
  default: number;
  // grouping context for the editor:
  routeIndex?: number;
  routeName?: string;
  nodeId?: string;
  nodeName?: string;
}

const SYS = SYSTEM_ENTITY_NAMES;

/**
 * Whether a route may expose a volume target. True only when it's monitored AND
 * no other route can run concurrently on the same flow sensor — i.e. no sibling
 * shares both the flow sensor and the destination. Different-destination siblings
 * are already mutually exclusive via the firmware conflict mask, so they never
 * read the sensor at the same time; same-destination siblings can, which would
 * make the per-route volume delta double-count. Duration targets have no such
 * constraint (they don't read a sensor). Used by both the tunable enumeration and
 * the YAML emission so the two never disagree (drift-guard).
 */
export function routeVolumeEligible(r: Manifest['routes'][number], routes: Manifest['routes']): boolean {
  if (!r.monitored || !r.flow_sensor) return false;
  return !routes.some((o) =>
    o.key !== r.key && o.flow_sensor === r.flow_sensor && (o.destination ?? '') === (r.destination ?? ''),
  );
}

/** Enumerate every runtime-tunable number a controller exposes, in a stable order
 *  (controller, then per-route, then per-sensor). Mirrors the codegen emit
 *  conditions exactly — see the drift-guard test. */
export function collectTunableNumbers(m: Manifest): TunableNumber[] {
  const out: TunableNumber[] = [];

  // Controller-wide safety timing (sensors.ts `safetyBlocks`).
  out.push(
    { key: 'flow_watchdog_s',      scope: 'controller', tier: 'tuning', field: 'flow_watchdog',  label: SYS.flowWatchdog.name,  unit: 's',     min: 5,   max: 120, step: 1,   default: m.timing.flow_watchdog },
    { key: 'flow_confirm_s',       scope: 'controller', tier: 'tuning', field: 'flow_confirm',   label: SYS.flowConfirm.name,   unit: 's',     min: 3,   max: 60,  step: 1,   default: m.timing.flow_confirm },
    { key: 'flow_threshold_l_min', scope: 'controller', tier: 'tuning', field: 'flow_threshold', label: SYS.flowThreshold.name, unit: 'L/min', min: 0.1, max: 20,  step: 0.1, default: m.timing.flow_threshold },
    { key: 'claim_lease_s',        scope: 'controller', tier: 'tuning', field: 'claim_lease',    label: SYS.claimLease.name,    unit: 's',     min: 30,  max: 600, step: 10,  default: 90 },
  );

  // Per-route runtime + level setpoints (sensors.ts `runtimeBlocks` + `safetyThresholdBlocks`).
  m.routes.forEach((r, i) => {
    const names = routeEntityNames(r);
    const routeName = r.name || r.key;
    out.push({ key: `route_${i}_max_runtime`, scope: 'route', tier: 'tuning', field: 'max_runtime', label: names.maxRuntime.name, unit: 'min', min: 1, max: 120, step: 1, default: Math.max(1, Math.round(r.max_runtime_seconds / 60)), routeIndex: i, routeName });
    // Timed-open target — clean stop after N seconds. Any route (no flow sensor
    // needed). 0 = off. max_runtime stays the safety backstop above it.
    out.push({ key: `route_${i}_target_duration_s`, scope: 'route', tier: 'tuning', field: 'target_duration_s', label: names.targetDuration.name, unit: 's', min: 0, max: 7200, step: 1, default: 0, routeIndex: i, routeName });
    // Volume target — clean stop after N litres delivered. Only where the flow
    // sensor isn't shared with a concurrent sibling (see routeVolumeEligible). 0 = off.
    if (routeVolumeEligible(r, m.routes)) {
      out.push({ key: `route_${i}_target_volume_l`, scope: 'route', tier: 'tuning', field: 'target_volume_l', label: names.targetVolume.name, unit: 'L', min: 0, max: 100000, step: 1, default: 0, routeIndex: i, routeName });
    }
    if (r.source_has_level) {
      out.push({ key: routeSourceMinNumber(i), scope: 'route', tier: 'tuning', field: 'source_min_pct', label: names.sourceMinLevel.name, unit: '%', min: 0, max: 100, step: 1, default: r.source_min_pct, routeIndex: i, routeName });
    }
    if (r.dest_has_level) {
      out.push({ key: routeDestMaxNumber(i), scope: 'route', tier: 'tuning', field: 'dest_max_pct', label: names.destMaxLevel.name, unit: '%', min: 0, max: 100, step: 1, default: r.dest_max_pct, routeIndex: i, routeName });
    }
  });

  // Per level-monitored tank: pressure-sensor calibration (pressure-sensor-shared
  // `emitPressureCalNumbers`, emitted when pressure_pin + sensor_max_psi are set).
  for (const node of m.nodes) {
    if (node.kind !== 'tank') continue;
    const pin = node['pressure_pin'];
    const maxPsi = node['pressure_sensor_max_psi'] as number | undefined;
    if (!pin || typeof maxPsi !== 'number') continue;
    const idn = { id: node.id };
    const names = pressureSensorHaNames({ name: node.name });
    const heightM = node['height_m'] as number | undefined;
    const elevM = (node['pressure_elevation_m'] as number | undefined) ?? 0;
    const cal = heightM != null
      ? deriveTankCalibration(heightM, elevM)
      : { p_empty_psi: 0, p_full_psi: maxPsi, working_span_psi: maxPsi };
    const base = { scope: 'node' as const, tier: 'calibration' as const, unit: 'psi', min: 0, max: 200, step: 0.1, nodeId: node.id, nodeName: node.name };
    out.push(
      { ...base, key: pressureSensorRangeMinId(idn), field: 'range_min', label: names.rangeMin, default: 0 },
      { ...base, key: pressureSensorRangeMaxId(idn), field: 'range_max', label: names.rangeMax, default: maxPsi },
      { ...base, key: pressureSensorCalEmptyId(idn), field: 'cal_empty', label: names.calEmpty, default: round2(cal.p_empty_psi) },
      { ...base, key: pressureSensorCalFullId(idn),  field: 'cal_full',  label: names.calFull,  default: round2(cal.p_full_psi) },
    );
  }

  // Per valve: travel time (time_based cover open/close duration) — an install-time
  // mechanical commissioning value (valve.ts `number:` block).
  for (const node of m.nodes) {
    if (node.kind !== 'valve') continue;
    const travel = node['travel_time'] as number | undefined;
    out.push({
      key: valveTravelTimeId({ id: node.id }), scope: 'node', tier: 'calibration', field: 'travel_time',
      label: `${node.name} Travel Time (s)`, unit: 's', min: 1, max: 30, step: 1,
      default: typeof travel === 'number' ? travel : 15, nodeId: node.id, nodeName: node.name,
    });
  }

  return out;
}

const round2 = (v: number): number => Math.round(v * 100) / 100;
