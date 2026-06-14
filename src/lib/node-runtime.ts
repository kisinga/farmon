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
import type { TelemetryRole } from './codegen-ids';

/** Coarse live state bucket. Mirror of the frozen farm-scada-card vocabulary. */
export type RuntimeState = 'on' | 'off' | 'fault' | 'unavailable' | 'unknown';

/** One node's live state: the bucket (drives `state-*` classes / animation) plus
 *  the raw numeric/text reading for value-bearing nodes (tank %, flow L/min, …). */
export interface NodeRuntime {
  state: RuntimeState;
  value: number | null;
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
  const value = reading && Number.isFinite(reading.reported) ? reading.reported : null;
  const text = reading?.reported_text || null;
  if (!online) return { state: 'unavailable', value, text };
  if (!reading) return { state: 'unknown', value, text };
  let state: RuntimeState;
  switch (ch.kind) {
    case 'bool':  state = reading.reported >= 0.5 ? 'on' : 'off'; break;
    case 'cover': state = reading.reported > 0 ? 'on' : 'off'; break;
    case 'enum':
    case 'text':  state = stateBucket(reading.reported_text); break;
    default:      state = stateBucket(String(reading.reported)); break; // numeric `state`
  }
  return { state, value, text };
}

/**
 * Which of a node's channels best represents it, when a node emits several
 * (a flow sensor emits rate + total; a filter emits multiple pressures).
 * Higher wins: an actuator's on/off beats a rate, which beats a level/pressure,
 * which beats a cumulative total. Keeps the projection deterministic.
 */
export function channelPriority(role: TelemetryRole | undefined): number {
  switch (role) {
    case 'pump': case 'valve': case 'dosing': return 3;
    case 'flow': return 2;
    case 'level': case 'pressure': return 1;
    default: return 0; // flow_total, filter_inlet/outlet/delta
  }
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
