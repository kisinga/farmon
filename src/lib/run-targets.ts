/**
 * Run targets — the shared "how a run ends" model. A scheduled automation and a
 * manual on-demand run both stop on the same set of overrides (a StopSpec on the
 * wire); this is the one owner of that shape and of the editor metadata, so the
 * automations editor and the dashboard run picker can't drift on bits, bounds, or
 * which targets a route may offer. Bits come from OVERRIDE_BITS (codegen-ids.ts,
 * mirrored to the firmware enum); bounds mirror tunable-numbers.ts.
 */
import { OVERRIDE_BITS } from './codegen-ids';

/**
 * The per-run stop-condition override carried on the wire (the StopSpec).
 * `override_mask` selects which `ov_*` fields are active (see OVERRIDE_BITS); an
 * inactive field falls through to the route's baked/live tunable on the device.
 * `NewAutomationRow` extends this, and a manual targeted run sends exactly these
 * fields, so the two paths serialize one identical object.
 */
export interface StopSpecOverride {
  override_mask: number;
  ov_source_min_pct: number;
  ov_dest_max_pct: number;
  ov_max_runtime_min: number;
  ov_target_duration_s: number;
  ov_target_volume_l: number;
}

/** One overridable run target, shared verbatim by the automations editor and the
 *  dashboard run picker (one model, no second paradigm). `bit` is an OVERRIDE_BITS
 *  value. Both surfaces render it as a toggle + value, combinable (the device stops
 *  on whichever active target trips first). */
export interface RunTargetField {
  key: 'ov_source_min_pct' | 'ov_dest_max_pct' | 'ov_max_runtime_min' | 'ov_target_duration_s' | 'ov_target_volume_l';
  bit: number;
  /** Display label. */
  label: string;
  /** Display unit (what the operator sees / types). */
  unit: string;
  /** Bounds in DISPLAY units. */
  min: number;
  max: number;
  /** displayValue × scale = the wire value. Default 1; duration is entered in
   *  minutes (scale 60) since its wire field `ov_target_duration_s` is seconds. */
  scale?: number;
  /** Seeded quick-pick values (display units) for the run picker. */
  chips?: number[];
  /** Offered in the dashboard run picker as a "how this run ends" target. The
   *  others (max runtime, source min) are schedule-only safety gates. Which run
   *  targets a given route actually offers is decided by the capability owner
   *  ([route-capabilities.ts]), not a flag here. */
  runTarget?: boolean;
}

/** Per-route context that tightens a target's bounds to reality. */
export interface RouteTargetCtx {
  /** Destination tank capacity (litres). Caps the volume target (you can't pump more
   *  than the tank holds) and seeds capacity-derived chips. */
  destCapacityL?: number;
}

/** The effective max for a target field on a route, in display units: the volume
 *  target is capped at the destination tank's capacity, within the field's own hard
 *  bound. One owner so the run picker and the automations editor never disagree. */
export function runTargetMax(field: RunTargetField, ctx?: RouteTargetCtx): number {
  if (field.key === 'ov_target_volume_l' && ctx?.destCapacityL && ctx.destCapacityL > 0) {
    return Math.max(field.min, Math.min(field.max, Math.floor(ctx.destCapacityL)));
  }
  return field.max;
}

/** Quick-pick chips for a target, in display units: the volume target derives
 *  25/50/100% of the destination tank (when capacity is known), else the static chips. */
export function runTargetChips(field: RunTargetField, ctx?: RouteTargetCtx): number[] {
  if (field.key === 'ov_target_volume_l' && ctx?.destCapacityL && ctx.destCapacityL > 0) {
    const cap = Math.floor(ctx.destCapacityL);
    // Dedup + drop non-positive, so a tiny tank doesn't yield "0" or repeated chips.
    return [...new Set([Math.round(cap * 0.25), Math.round(cap * 0.5), cap])].filter((v) => v > 0 && v >= field.min);
  }
  return field.chips ?? [];
}

/** The overridable run targets, in display order (run targets first, then the
 *  safety gates). Bits ← OVERRIDE_BITS (pinned to the firmware enum by
 *  test/override-bits.test.ts); bounds mirror tunable-numbers.ts (in display units). */
export const RUN_TARGET_FIELDS: RunTargetField[] = [
  { key: 'ov_target_volume_l',   bit: OVERRIDE_BITS.volume,      label: 'Target volume', unit: 'L',   min: 0, max: 100000, runTarget: true, chips: [100, 500, 1000] },
  { key: 'ov_target_duration_s', bit: OVERRIDE_BITS.duration,    label: 'Run duration',  unit: 'min', min: 0, max: 120, scale: 60, runTarget: true, chips: [5, 15, 30] },
  { key: 'ov_dest_max_pct',      bit: OVERRIDE_BITS.dest_max,    label: 'Stop at level', unit: '%',   min: 0, max: 100, runTarget: true, chips: [50, 80, 100] },
  { key: 'ov_max_runtime_min',   bit: OVERRIDE_BITS.max_runtime, label: 'Max runtime',   unit: 'min', min: 1, max: 120 },
  { key: 'ov_source_min_pct',    bit: OVERRIDE_BITS.source_min,  label: 'Source min',    unit: '%',   min: 0, max: 100 },
];
