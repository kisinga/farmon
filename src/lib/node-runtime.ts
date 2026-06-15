/**
 * Node runtime state — the single node-centric live-state projection.
 *
 * Bridges the telemetry enumeration ({@link TelemetryChannel}) and a controller's
 * live shadow into one coarse state per node, using the frozen `state-*`
 * vocabulary the (now-removed) farm-scada-card established. One mapping serves
 * the live X6 map today and any future SVG-export / HA consumer — node groups
 * carry `data-node-id` and exactly one `state-<bucket>` class.
 *
 * Pure + DOM-only helpers: no Angular, no framework. The read semantics live
 * here, next to the channel-kind definitions they mirror.
 */
import type { TelemetryChannel } from './telemetry-channels';
import { ROLE_META, type TelemetryRole } from './codegen-ids';

/** Coarse live state bucket. Mirror of the frozen farm-scada-card vocabulary. */
export type RuntimeState = 'on' | 'off' | 'fault' | 'unavailable' | 'unknown';

/** One node's live state: the bucket (drives `state-*` classes / animation) plus
 *  the raw numeric/text reading for value-bearing nodes (tank %, flow L/min, …). */
export interface NodeRuntime {
  /** Coarse activation: `on` = running / open / flowing (drives the accent +
   *  motion); `off`/`unknown` neutral; `fault`/`unavailable` as named. */
  state: RuntimeState;
  value: number | null;
  /** Display unit for `value` (from the role): 'L/min', '%', 'psi'. */
  unit: string | null;
  /** `value` normalised to 0..1 for bounded roles (tank level) — drives `--fill`.
   *  Null when the role has no min/max (flow, pressure). */
  fill: number | null;
  text: string | null;
}

/** A single channel reading (the fields the projection needs from a shadow row). */
export interface ChannelReading {
  reported: number;
  reported_text: string;
}

/** Map a textual state token to a bucket — the frozen farm-scada-card rules,
 *  applied to enum/text channels and as the numeric fallback. */
export function stateBucket(token: string | undefined): RuntimeState {
  if (token == null) return 'unknown';
  const s = token.toLowerCase();
  if (s === 'unavailable') return 'unavailable';
  if (s === 'unknown' || s === 'none' || s === '') return 'unknown';
  if (s === 'on' || s === 'open' || s === 'opening' || s === 'home' || s === 'active' || s === 'heat' || s === 'cool') return 'on';
  if (s === 'off' || s === 'closed' || s === 'closing' || s === 'away' || s === 'idle' || s === 'standby') return 'off';
  if (s === 'problem' || s === 'fault' || s === 'error') return 'fault';
  return Number.isFinite(Number(s)) ? 'on' : 'unknown';
}

/**
 * Project one channel's reading into a node runtime state. The channel `kind`
 * (the wire read-semantics) decides how the reading buckets:
 *  - `bool`  (pump/dosing relay) → reported ≥ 0.5 is on
 *  - `cover` (valve position)    → any opening (> 0) is on
 *  - `enum` / `text`             → the wire token, via {@link stateBucket}
 *  - `state` (numeric sensor)    → data present reads as on (value carries it)
 * Offline controller → `unavailable`; no reading yet → `unknown`.
 */
export function bucketReading(
  ch: TelemetryChannel,
  reading: ChannelReading | undefined,
  online: boolean,
): NodeRuntime {
  const meta = ch.role ? ROLE_META[ch.role] : undefined;
  const value = reading && Number.isFinite(reading.reported) ? reading.reported : null;
  const text = reading?.reported_text || null;
  const unit = meta?.unit ?? null;
  // `fill` only for bounded roles (tank level); clamped 0..1.
  const fill =
    value != null && meta?.min != null && meta?.max != null && meta.max > meta.min
      ? Math.min(1, Math.max(0, (value - meta.min) / (meta.max - meta.min)))
      : null;
  const done = (state: RuntimeState): NodeRuntime => ({ state, value, unit, fill, text });
  if (!online) return done('unavailable');
  if (!reading) return done('unknown');
  switch (ch.kind) {
    case 'bool':  return done(reading.reported >= 0.5 ? 'on' : 'off'); // relay
    case 'cover': return done(reading.reported > 0 ? 'on' : 'off');    // any opening = open
    case 'enum':
    case 'text':  return done(stateBucket(reading.reported_text));
    default:
      // Numeric `state` channel — the role's `stateKind` decides: a flow is
      // active when >0; a level/pressure carries no on/off (value is the meaning).
      return done(meta?.stateKind === 'positive' ? (reading.reported > 0 ? 'on' : 'off') : 'unknown');
  }
}

// --- Value formatting (shared SSOT for the map labels and the cards) ---

/** Round a reading for display: integers/large values whole, else one decimal.
 *  NaN renders as an em dash. */
export function formatNumber(n: number): string {
  if (Number.isNaN(n)) return '—';
  return Math.abs(n) >= 100 || Number.isInteger(n) ? String(Math.round(n)) : n.toFixed(1);
}

/** Format a reading with its unit, e.g. `12 L/min`, `73%`, `2.4 psi`. */
export function formatReading(value: number, unit?: string | null): string {
  const n = formatNumber(value);
  if (!unit || n === '—') return n;
  return unit === '%' ? `${n}%` : `${n} ${unit}`;
}

/**
 * Which of a node's channels best represents it, when it emits several (a flow
 * sensor emits rate + total; a filter emits multiple pressures). Reads each
 * role's `salience` — higher wins — so the precedence lives in `ROLE_META`, not here.
 */
export function channelPriority(role: TelemetryRole | undefined): number {
  return role ? ROLE_META[role].salience : 0;
}

// --- DOM helpers (the shared `state-*` class vocabulary) ---

const STATE_CLASSES: readonly `state-${RuntimeState}`[] = [
  'state-on', 'state-off', 'state-fault', 'state-unavailable', 'state-unknown',
];

/** Apply the one correct `state-*` class to an element, clearing the others. */
export function applyStateClass(el: Element, state: RuntimeState): void {
  for (const cls of STATE_CLASSES) el.classList.remove(cls);
  el.classList.add(`state-${state}`);
}
