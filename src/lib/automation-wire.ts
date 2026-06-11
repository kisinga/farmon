/**
 * Runtime automation wire format — the single spec for the packed binary an
 * automation set rides on, retained per controller, that the device memcpy's
 * into its `RuntimeAutomation[]` table.
 *
 * ONE layout, three implementors that must never drift:
 *   - this module — the reference encoder + the bit/field offsets (drift-guard
 *     test pins them to a golden vector),
 *   - the firmware C++ struct ([codegen/generators/automation-engine.ts],
 *     `static_assert(sizeof == AUTOMATION_RECORD_BYTES)`),
 *   - the Go server encoder (maji-server) that actually publishes it.
 *
 * Layout (little-endian, packed, no padding beyond the explicit `_pad`):
 *
 *   Header (6 bytes):
 *     u16 magic_version     = AUTOMATION_WIRE_MAGIC
 *     u16 route_set_version  (device refuses the set unless this == its baked value)
 *     u8  count
 *     u8  _pad
 *   Record × count (20 bytes each):
 *     u8  enabled            (0/1)
 *     u8  trigger_type       (0=time 1=level)
 *     u8  days_mask          (bit0=MON..bit6=SUN; 0 = every day)
 *     u8  level_threshold_pct
 *     u16 route_index        (browser-resolved; valid only when route_set_version matches)
 *     u16 time_min           (minutes since midnight; time trigger)
 *     u8  override_mask      (OV_* bits — see codegen/generators/routes.ts)
 *     u8  ov_source_min_pct
 *     u8  ov_dest_max_pct
 *     u8  _pad
 *     u16 ov_max_runtime_min
 *     u16 ov_target_duration_s
 *     u32 ov_target_volume_l
 */
import type { Manifest } from './manifest.types';

/** 0xA0 'automation', 0x01 wire revision. Bump the low byte on any layout change. */
export const AUTOMATION_WIRE_MAGIC = 0xa001;
export const AUTOMATION_HEADER_BYTES = 6;
export const AUTOMATION_RECORD_BYTES = 20;
export const MAX_AUTOMATIONS = 32;

export type TriggerKind = 'time' | 'level';

/** One automation as the wire carries it — already route-resolved (route_index). */
export interface WireAutomation {
  enabled: boolean;
  trigger_type: 0 | 1;          // 0=time 1=level
  days_mask: number;            // bit0=MON..bit6=SUN; 0 = every day
  level_threshold_pct: number;
  route_index: number;
  time_min: number;             // minutes since midnight
  override_mask: number;
  ov_source_min_pct: number;
  ov_dest_max_pct: number;
  ov_max_runtime_min: number;
  ov_target_duration_s: number;
  ov_target_volume_l: number;
}

/**
 * Stable 16-bit version of the controller's ordered route-key list. Baked into
 * firmware (routes.h) AND stamped by the browser onto each automation set so the
 * device can refuse a set authored against a different route table (fail-safe:
 * an index could otherwise point at the wrong route). FNV-1a/32 truncated to 16.
 * Both the codegen bake and the browser stamp call this exact function.
 */
export function routeSetVersion(m: Manifest): number {
  let hash = 0x811c9dc5;
  const s = m.routes.map((r) => r.key).join('\n');
  for (let i = 0; i < s.length; i++) {
    hash ^= s.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash & 0xffff;
}

/**
 * Reference encoder — header + records, packed little-endian. The Go server
 * mirrors this byte-for-byte; the drift-guard test pins the layout. `count` is
 * capped at MAX_AUTOMATIONS. An empty set encodes as a valid header with count 0
 * (never a zero-length payload, which the device's on_message would ignore).
 */
export function serializeAutomationSet(routeSetVer: number, autos: WireAutomation[]): Uint8Array {
  const count = Math.min(autos.length, MAX_AUTOMATIONS);
  const buf = new ArrayBuffer(AUTOMATION_HEADER_BYTES + count * AUTOMATION_RECORD_BYTES);
  const dv = new DataView(buf);
  dv.setUint16(0, AUTOMATION_WIRE_MAGIC, true);
  dv.setUint16(2, routeSetVer & 0xffff, true);
  dv.setUint8(4, count);
  dv.setUint8(5, 0);
  let o = AUTOMATION_HEADER_BYTES;
  for (let i = 0; i < count; i++) {
    const a = autos[i];
    dv.setUint8(o + 0, a.enabled ? 1 : 0);
    dv.setUint8(o + 1, a.trigger_type);
    dv.setUint8(o + 2, a.days_mask & 0xff);
    dv.setUint8(o + 3, clampU8(a.level_threshold_pct));
    dv.setUint16(o + 4, a.route_index & 0xffff, true);
    dv.setUint16(o + 6, a.time_min & 0xffff, true);
    dv.setUint8(o + 8, a.override_mask & 0xff);
    dv.setUint8(o + 9, clampU8(a.ov_source_min_pct));
    dv.setUint8(o + 10, clampU8(a.ov_dest_max_pct));
    dv.setUint8(o + 11, 0);
    dv.setUint16(o + 12, a.ov_max_runtime_min & 0xffff, true);
    dv.setUint16(o + 14, a.ov_target_duration_s & 0xffff, true);
    dv.setUint32(o + 16, a.ov_target_volume_l >>> 0, true);
    o += AUTOMATION_RECORD_BYTES;
  }
  return new Uint8Array(buf);
}

const clampU8 = (v: number) => Math.max(0, Math.min(255, Math.round(v)));
