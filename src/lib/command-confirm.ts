/**
 * Command confirmation descriptor — the single (action, entity) → "how do we know
 * it landed" table. Pure and UI-agnostic; the client command-lifecycle store feeds
 * it live observations and renders the resulting phase.
 *
 * The model is desired → reported convergence: every operator command drives an
 * entity toward a desired state, and confirmation is the entity's reported state
 * (the self-healing telemetry shadow) reaching it. A `command_id`-correlated
 * transition event is a fast-path hint + the refusal channel, never the sole
 * mechanism — events drop, so convergence on the shadow (plus a TTL backstop) is
 * what actually resolves a command. Behaviour is baked into the shape here once,
 * instead of re-hand-rolled per control.
 */
import {
  routeStateSensor, COMMAND_TTL_S,
  type CommandAction,
} from './codegen-ids';
import type { RouteControl, ActuatorControl, AutomationControl, SetpointControl } from './dashboard-spec';

/** Lifecycle phase a control renders. `pending` = in flight / not yet reflected;
 *  `confirmed` = the device acted; `refused` = a guard/queue rejected it (carries a
 *  reason token); `expired` = no confirmation before the staleness TTL. */
export type CommandPhase = 'pending' | 'confirmed' | 'refused' | 'expired';

/** A live reading the store hands to `classify`. */
export interface ConfirmObservation {
  /** Shadow numeric `reported` for `descriptor.sensor`; undefined ⇒ no row yet. */
  reported?: number;
  /** Shadow categorical token for `descriptor.sensor` (route state etc.). */
  reportedText?: string;
  /** Newest `state_events` row carrying this command's `command_id`, if any. */
  correlated?: { to: string; reason: string };
  /** ms since the command was registered (one-shot: TTL clock; sustained: grace clock). */
  ageMs: number;
  /** Owning controller presence — sustained divergence is judged ONLY when online. */
  online: boolean;
}

/** The behaviour for one dispatched command. */
export interface ConfirmDescriptor {
  /** Shadow sensor (relative; full key `${controller}/${sensor}`) whose reported
   *  value confirms. Undefined ⇒ no convergence channel (fan-out / fire-and-forget):
   *  confirmed as soon as the command is accepted. */
  sensor?: string;
  /** Held command: the store re-asserts it and auto-releases on divergence. Only a
   *  `node_set { on:true }` claim is sustained. */
  sustained: boolean;
  /** One-shot staleness window (ms). */
  ttlMs: number;
  /** Sustained divergence grace (ms) — a held claim isn't judged blocked before this. */
  graceMs: number;
  classify(obs: ConfirmObservation): { phase: CommandPhase; reason?: string };
}

const TTL_MS = COMMAND_TTL_S * 1000;
/** Sustained claim grace before a not-running report counts as blocked. Matches the
 *  legacy reconcile grace; see the dead-man invariants. */
export const HOLD_GRACE_MS = 8_000;

/** The firmware dead-man lease floor — the minimum `claim_lease_s` an operator can
 *  set on the device (mirrors the `number:` bounds in codegen sensors). A held
 *  actuator must be re-claimed faster than this or it lapses. The device value
 *  isn't published, so the dashboard designs against the floor, not the default. */
export const CLAIM_LEASE_FLOOR_S = 30;
/** Operator-hold re-claim cadence. Half the lease floor → a hold never lapses for
 *  ANY operator-set lease (30–600s), with margin for RTT/jitter. */
export const HOLD_RECLAIM_MS = (CLAIM_LEASE_FLOOR_S / 2) * 1000;

const isOn = (v?: number): boolean => v != null && v >= 0.5;
const expiredIf = (obs: ConfirmObservation): boolean => obs.ageMs > TTL_MS;

/** A refusal outcome echoed on the correlated event. */
function refusal(correlated?: { to: string; reason: string }): { phase: CommandPhase; reason?: string } | null {
  if (correlated && (correlated.to === 'REFUSED' || correlated.to === 'REJECTED')) {
    return { phase: 'refused', reason: correlated.reason || correlated.to };
  }
  return null;
}

/**
 * Build the descriptor for a command. `ctx` carries the entity it targets and the
 * desired value (`on` for switches, `value` for `config_set`).
 */
export function confirmDescriptor(
  action: CommandAction,
  ctx: {
    route?: RouteControl;
    actuator?: ActuatorControl;
    automation?: AutomationControl;
    setpoint?: SetpointControl;
    on?: boolean;
    value?: number;
  } = {},
): ConfirmDescriptor {
  const base = { sustained: false, ttlMs: TTL_MS, graceMs: HOLD_GRACE_MS };

  switch (action) {
    // --- Routes: confirmed once the route's state token reflects the command. The
    //     token's own working states (PREPARING/STOPPING) are the confirmation that
    //     the device acted; the card's token view then drives the visuals. -------
    case 'route_start':
      return {
        ...base,
        sensor: routeStateSensor(ctx.route?.routeId ?? -1),
        classify: (obs) => {
          const r = refusal(obs.correlated);
          if (r) return r;
          if (obs.correlated?.to === 'QUEUED') return { phase: 'confirmed', reason: 'QUEUED' };
          const t = obs.reportedText;
          if (t === 'PREPARING' || t === 'RUNNING') return { phase: 'confirmed' };
          if (expiredIf(obs)) return { phase: 'expired' };
          return { phase: 'pending' };
        },
      };
    case 'route_stop':
      return {
        ...base,
        sensor: routeStateSensor(ctx.route?.routeId ?? -1),
        classify: (obs) => {
          const r = refusal(obs.correlated);
          if (r) return r;
          const t = obs.reportedText;
          if (t === 'STOPPING' || t === 'IDLE' || t === '' || t == null) return { phase: 'confirmed' };
          if (expiredIf(obs)) return { phase: 'expired' };
          return { phase: 'pending' };
        },
      };
    case 'fault_reset':
      return {
        ...base,
        sensor: routeStateSensor(ctx.route?.routeId ?? -1),
        classify: (obs) => {
          const r = refusal(obs.correlated);
          if (r) return r;
          const t = obs.reportedText;
          if (t != null && t !== 'FAULT') return { phase: 'confirmed' };
          if (expiredIf(obs)) return { phase: 'expired' };
          return { phase: 'pending' };
        },
      };

    // --- Manual actuator claim/release. A claim (on) is sustained: convergence on
    //     the reported sensor confirms it, and a not-running report past the grace
    //     while online is a safety block — STATE-based, not waiting for an event
    //     (the event only supplies the reason). Offline never auto-releases (the
    //     device's dead-man lease is the safety there). ---------------------------
    case 'node_set': {
      const on = ctx.on === true;
      return {
        ...base,
        sensor: ctx.actuator?.reportedSensor,
        sustained: on,
        classify: (obs) => {
          const r = refusal(obs.correlated);
          if (r) return r;
          if (obs.correlated?.to === 'APPLIED') return { phase: 'confirmed' };
          if (on) {
            if (isOn(obs.reported)) return { phase: 'confirmed' };
            // Blocked: online, past grace, and still not running (incl. no row at all).
            if (obs.online && obs.ageMs > HOLD_GRACE_MS) {
              return { phase: 'refused', reason: obs.correlated?.reason || '' };
            }
            return { phase: 'pending' };
          }
          // Release: confirmed once it reads off (absence of a row counts as off).
          if (obs.reported == null || !isOn(obs.reported)) return { phase: 'confirmed' };
          if (expiredIf(obs)) return { phase: 'expired' };
          return { phase: 'pending' };
        },
      };
    }

    // --- Bool switches: confirmed when the reported switch matches desired. -------
    case 'safety_override':
    case 'automation_set': {
      const on = ctx.on === true;
      const sensor = action === 'safety_override' ? 'safety_override' : ctx.automation?.enableSensor;
      return {
        ...base,
        sensor,
        classify: (obs) => {
          if (obs.reported != null && isOn(obs.reported) === on) return { phase: 'confirmed' };
          if (expiredIf(obs)) return { phase: 'expired' };
          return { phase: 'pending' };
        },
      };
    }

    // --- Numeric setpoint: confirmed when the reported value converges to the
    //     written one. No event channel and no refusal (the UI clamps in range). ---
    case 'config_set': {
      const target = ctx.value ?? 0;
      return {
        ...base,
        sensor: ctx.setpoint?.key,
        classify: (obs) => {
          if (obs.reported != null && Math.round(obs.reported) === Math.round(target)) {
            return { phase: 'confirmed' };
          }
          if (expiredIf(obs)) return { phase: 'expired' };
          return { phase: 'pending' };
        },
      };
    }

    // --- Fan-out / fire-and-forget (named exceptions): no convergence channel, so
    //     accepted == confirmed. The brief pending is just the POST in-flight window
    //     (the store reports pending until the command_id lands). --------------------
    case 'stop_all':
    case 'reset_faults':
    case 'clear_queue':
    default:
      return { ...base, classify: () => ({ phase: 'confirmed' }) };
  }
}
