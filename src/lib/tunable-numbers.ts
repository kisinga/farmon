/**
 * Runtime-tunable device numbers — the single enumeration of every ESPHome
 * `number:` entity the server-owned desired config drives at runtime.
 *
 * One definition, three consumers: the firmware config-apply (each number set from
 * the retained /config kv) + value publish ([codegen/generators/mqtt.ts]), the
 * dashboard operator editors (which write the desired value to the DB), and a
 * drift-guard test that asserts this list matches exactly the `number:` ids and
 * bounds the codegen emits — so the runtime/UI view can never silently diverge
 * from what the device actually exposes.
 *
 * Each `number:` is `entity_category: config` and stateless re config: it does NOT
 * restore_value — the server + the retained /config message are the single source of
 * truth, so the device re-applies the desired value from /config on every (re)connect.
 * The applied value publishes in the snapshot under the same id, and the dashboard
 * reads it from the shadow. `tunableKvKeys()` is the ordered kv-key contract the
 * server packs the /config payload from.
 */
import type { Manifest } from './manifest.types';
import { SYSTEM_ENTITY_NAMES, routeEntityNames } from './entity-names';
import {
  routeSourceMinNumber, routeDestMaxNumber, valveTravelTimeId,
  pressureSensorCalEmptyId, pressureSensorCalFullId,
} from './codegen-ids';
import { pressureSensorHaNames } from './pressure-sensor-shared';
import { deriveTankCalibration } from './units';
import { manifestRouteCapabilities } from './route-capabilities';

export type TunableScope = 'controller' | 'route' | 'node';
/** `calibration` = install-time hardware commissioning (pressure-sensor anchors —
 *  safety-relevant, drives tank %; valve travel time); `tuning` = bounded
 *  operational values (timings, runtime, level setpoints). */
export type TunableTier = 'tuning' | 'calibration';
export type TunableField =
  | 'flow_watchdog' | 'flow_confirm' | 'flow_threshold' | 'claim_lease'
  | 'max_runtime' | 'source_min_pct' | 'dest_max_pct'
  | 'target_volume_l' | 'target_duration_s' | 'flow_stall_enable'
  | 'cal_empty' | 'cal_full'
  | 'travel_time';

/** One runtime-settable number. `key` is the ESPHome number id == the desired-config
 *  kv key == the telemetry sensor its live value publishes under. */
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
  /** Render hint for the operator editor. 'toggle' = a 0/1 boolean shown as a
   *  switch rather than a number spinner (min 0, max 1, step 1). */
  display?: 'toggle';
  /** One-line plain-language explanation, shown as a tooltip in the editor. */
  hint?: string;
  // grouping context for the editor:
  routeIndex?: number;
  routeName?: string;
  nodeId?: string;
  nodeName?: string;
}

const SYS = SYSTEM_ENTITY_NAMES;

/**
 * Whether the firmware should expose a volume-target number for a route: it must be
 * runnable (has an actuator), monitored, and not share its meter with a concurrent
 * sibling to the same endpoint. Delegates to the single capability owner's
 * `targets.volume.available`, so the emitted entity, this enumeration, and the
 * dashboard run picker can never disagree (drift-guard) — and a non-runnable metered
 * pipe no longer gets a dead volume entity. The owner keys on the real endpoint node,
 * fixing the prior `destination ?? ''` collapse that hid volume on metered non-tank routes.
 */
export function routeVolumeEligible(r: Manifest['routes'][number]): boolean {
  return manifestRouteCapabilities(r).targets.volume.available;
}

/**
 * Whether a route can detect a full destination tank and stop cleanly (flow-stall
 * against a float valve, OR a pump-reliable destination level sensor). Delegates to
 * the single capability owner so the flow-stall default, the full-detection lint
 * rule, and the run UI can never disagree.
 */
export function canStopOnFull(r: Manifest['routes'][number]): boolean {
  return manifestRouteCapabilities(r).canStopOnFull;
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
    // Flow-stall full-detection toggle — only on monitored routes (needs a flow
    // sensor to observe a stall). 1 = on (default, preserves baseline behaviour),
    // 0 = off. The no-flow dry-run fault is independent and stays on regardless.
    if (r.flow_sensor) {
      out.push({ key: `route_${i}_flow_stall_enable`, scope: 'route', tier: 'tuning', field: 'flow_stall_enable', label: names.flowStall.name, unit: '', min: 0, max: 1, step: 1, default: 1, display: 'toggle', hint: 'Flow that started then stopped is read as a full tank, so the pump stops. Turn off to stop on tank level, volume, or time instead. Dry-run protection (flow never started) stays on regardless.', routeIndex: i, routeName });
    }
    // Volume target — clean stop after N litres delivered. Only where the flow
    // sensor isn't shared with a concurrent sibling (see routeVolumeEligible). 0 = off.
    if (routeVolumeEligible(r)) {
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

/**
 * The ordered list of `number:` ids (kv keys) the server packs into the retained
 * desired-config payload (configTopic), in the same stable order as
 * collectTunableNumbers. This is the wire contract the server's config-payload
 * builder iterates and the firmware config-apply dispatch is generated against —
 * one owner so the kv keys, the apply dispatch, and the drift-guard can't diverge.
 * (The server reads the desired VALUE for each key from the controller_config doc;
 * this list is only the key set + order.)
 */
export function tunableKvKeys(m: Manifest): string[] {
  return collectTunableNumbers(m).map((t) => t.key);
}

const round2 = (v: number): number => Math.round(v * 100) / 100;
