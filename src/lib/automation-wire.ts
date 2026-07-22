/**
 * Runtime automation wire format — the single spec for the packed binary an
 * automation set rides on, retained per controller, that the device memcpy's
 * into its `RuntimeAutomation[]` table.
 *
 * ONE layout, three implementors that must never drift:
 *   - this module — the reference encoder + decoder + the bit/field offsets
 *     (drift-guard test pins them to a golden vector + round-trips),
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
 *     u16 time_min           (minutes since UTC midnight; time trigger)
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
/** Fixed-width id field appended once per record AFTER the record block: the
 *  automation's whole PocketBase id (15 chars), null-padded to 16. The device
 *  echoes it as a route's origin actor so a fired automation resolves to a name.
 *  A reader that doesn't know about it stops after the records and ignores the
 *  trailing block. */
export const AUTOMATION_ID_BYTES = 16;

export type TriggerKind = 'time' | 'level';

/** One automation as the wire carries it — already route-resolved (route_index). */
export interface WireAutomation {
  /** The automation's whole PocketBase id, echoed back as a route's origin actor. */
  id: string;
  enabled: boolean;
  trigger_type: 0 | 1;          // 0=time 1=level
  days_mask: number;            // bit0=MON..bit6=SUN; 0 = every day
  level_threshold_pct: number;
  route_index: number;
  time_min: number;             // minutes since UTC midnight
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
  const buf = new ArrayBuffer(
    AUTOMATION_HEADER_BYTES + count * AUTOMATION_RECORD_BYTES + count * AUTOMATION_ID_BYTES,
  );
  const dv = new DataView(buf);
  const bytes = new Uint8Array(buf);
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
  // Trailing id block: one fixed 16-byte ascii field per record (null-padded).
  for (let i = 0; i < count; i++) {
    const id = autos[i].id ?? '';
    for (let j = 0; j < AUTOMATION_ID_BYTES - 1 && j < id.length; j++) {
      bytes[o + j] = id.charCodeAt(j) & 0x7f;
    }
    o += AUTOMATION_ID_BYTES;
  }
  return new Uint8Array(buf);
}

const clampU8 = (v: number) => Math.max(0, Math.min(255, Math.round(v)));

/** An automation row as the wire blob carries it: the NewAutomationRow fields the
 *  device persists (see src/lib/automation-routes.ts), plus the row id from the
 *  trailing id block. site/controller/name/route_key are NOT on the wire — the
 *  caller resolves them from route_index against the topology. */
export interface DecodedAutomation {
  id: string;
  enabled: boolean;
  trigger_type: 'time' | 'level';
  days_mask: number;
  level_threshold_pct: number;
  route_index: number;
  time_min: number;
  override_mask: number;
  ov_source_min_pct: number;
  ov_dest_max_pct: number;
  ov_max_runtime_min: number;
  ov_target_duration_s: number;
  ov_target_volume_l: number;
}

export interface DecodedAutomationSet {
  /** The route table version the set was stamped against (header @2). */
  route_set_version: number;
  rows: DecodedAutomation[];
}

/**
 * Reference decoder — the mirror of serializeAutomationSet, for the device-mode
 * app reading `GET /local/automations`. Validates like the firmware does: a
 * truncated payload or a bad magic is refused outright; a count-0 header decodes
 * to an empty set. The trailing id block is optional on read (per its contract:
 * a reader that doesn't know it stops after the records) — without it, ids
 * decode as ''. Extra trailing bytes are ignored (forward-compatible).
 */
export function decodeAutomationSet(bytes: Uint8Array): DecodedAutomationSet {
  if (bytes.length < AUTOMATION_HEADER_BYTES) {
    throw new Error(`Automation blob truncated: ${bytes.length} bytes, header needs ${AUTOMATION_HEADER_BYTES}.`);
  }
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (dv.getUint16(0, true) !== AUTOMATION_WIRE_MAGIC) {
    throw new Error('Automation blob refused: bad magic_version.');
  }
  const route_set_version = dv.getUint16(2, true);
  const count = dv.getUint8(4);
  if (count > MAX_AUTOMATIONS) {
    throw new Error(`Automation blob refused: count ${count} exceeds the ${MAX_AUTOMATIONS} cap.`);
  }
  const recordsEnd = AUTOMATION_HEADER_BYTES + count * AUTOMATION_RECORD_BYTES;
  if (bytes.length < recordsEnd) {
    throw new Error(`Automation blob truncated: ${count} records need ${recordsEnd} bytes, got ${bytes.length}.`);
  }
  const withIds = bytes.length >= recordsEnd + count * AUTOMATION_ID_BYTES;
  const rows: DecodedAutomation[] = [];
  for (let i = 0; i < count; i++) {
    const o = AUTOMATION_HEADER_BYTES + i * AUTOMATION_RECORD_BYTES;
    let id = '';
    if (withIds) {
      const idOff = recordsEnd + i * AUTOMATION_ID_BYTES;
      for (let j = 0; j < AUTOMATION_ID_BYTES - 1 && bytes[idOff + j] !== 0; j++) {
        id += String.fromCharCode(bytes[idOff + j]);
      }
    }
    rows.push({
      id,
      enabled: dv.getUint8(o + 0) !== 0,
      trigger_type: dv.getUint8(o + 1) === 1 ? 'level' : 'time',
      days_mask: dv.getUint8(o + 2),
      level_threshold_pct: dv.getUint8(o + 3),
      route_index: dv.getUint16(o + 4, true),
      time_min: dv.getUint16(o + 6, true),
      override_mask: dv.getUint8(o + 8),
      ov_source_min_pct: dv.getUint8(o + 9),
      ov_dest_max_pct: dv.getUint8(o + 10),
      ov_max_runtime_min: dv.getUint16(o + 12, true),
      ov_target_duration_s: dv.getUint16(o + 14, true),
      ov_target_volume_l: dv.getUint32(o + 16, true),
    });
  }
  return { route_set_version, rows };
}
