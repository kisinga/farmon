import { RESERVED_ACTOR_LABELS, type SnapshotEvent } from '@core';
import type { ActivityItem } from '../core/models/runtime';

/**
 * Device-mode activity mapping — pure functions, so the dashboard store can map
 * the snapshot's on-device event ring to the same ActivityItem rows the cloud
 * feed renders (and so the mapping is unit-testable without Angular).
 */

/**
 * Resolve each event's `ts` to a usable epoch seconds. The device stamps real
 * time only when its clock is trusted (RTC/SNTP); a 0 means "untrusted", so the
 * row is placed relative to the newest event's uptime against the snapshot's
 * receipt time — approximate, but stable across re-asserts of the same ring.
 * Returns a new array; events with a trusted ts pass through untouched.
 *
 * Boot-boundary rule: the ring can hold events restored from NVS after a
 * restart, and those carry `up` from the PREVIOUS boot — an uptime ABOVE the
 * reference (the newest event's). There is no receipt-relative placement for a
 * pre-boot event, so it stays untrusted (ts 0) and renders as
 * {@link BEFORE_RESTART} instead of clamping to a bogus "now" that would sort
 * above genuinely newer rows.
 */
export function normalizeSnapshotEvents(events: SnapshotEvent[], receivedMs: number): SnapshotEvent[] {
  if (!events.length || events.every((e) => e.ts > 0)) return events;
  const refUp = events[0].up; // newest-first: the closest thing to "now" on the device
  const refEpoch = receivedMs / 1000;
  return events.map((e) => {
    if (e.ts > 0) return e;
    if (e.up > refUp) return e; // previous boot (NVS restore): left unplaced — see BEFORE_RESTART
    return { ...e, ts: Math.max(0, Math.round(refEpoch - (refUp - e.up))) };
  });
}

/** Row timestamp for an unplaceable event (a pre-restart ring entry with an
 *  untrusted clock). The timeline's `shortTime` falls back to the raw string for
 *  an unparseable ts, so this renders verbatim; a numeric parse gives NaN → 0,
 *  so the row also sorts oldest in any merged feed. */
export const BEFORE_RESTART = 'before restart';

/**
 * One snapshot event → an Activity row. The badge is the action token (the card
 * colours it via EVENT_ACTION_MEANINGS); the label names the route; the reason
 * rides as the detail suffix. Actor resolution is the on-device counterpart of
 * the server's ingest-time actorLabel: reserved tags (panel / local-ui) read
 * from the shared RESERVED_ACTOR_LABELS, an automation id resolves to its name
 * from the on-device name store when known (else a bare "Automation"), and
 * anything else (a cloud user id) renders raw — the device has no user directory.
 */
export function deviceEventToActivity(
  e: SnapshotEvent,
  routeName: (routeId: number) => string,
  automationNames: Readonly<Record<string, string>>,
): ActivityItem {
  const reserved = RESERVED_ACTOR_LABELS[e.actor];
  let actor: string | undefined;
  let origin: string | undefined;
  let actorTitle: string | undefined;
  if (reserved) {
    // A device source, not a person — the chip reads the bare label (origin DEVICE).
    actor = reserved;
    origin = 'DEVICE';
    actorTitle = reserved;
  } else if (e.origin === 'AUTOMATION') {
    actor = automationNames[e.actor] ?? '';
    origin = 'AUTOMATION';
    actorTitle = actor ? `Automation · ${actor}` : '';
  } else if (e.actor) {
    actor = e.actor; // a cloud user id: no directory on the device, show it raw
    origin = e.origin;
  }
  return {
    // ts 0 (untrusted + unplaceable — a pre-restart ring entry) renders as
    // BEFORE_RESTART rather than epoch 0's bogus 1970 timestamp.
    ts: e.ts > 0 ? new Date(e.ts * 1000).toISOString() : BEFORE_RESTART,
    kind: 'transition',
    token: e.action,
    label: e.route >= 0 ? routeName(e.route) : 'controller',
    detail: e.reason || undefined,
    actor,
    origin,
    actorTitle,
    ok: e.action !== 'FAULT',
  };
}
