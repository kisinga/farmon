// device-activity: the snapshot `events[]` ring → Activity rows. Pins the
// untrusted-clock placement (ts 0 → uptime offset, with pre-restart NVS-restored
// events left unplaced as "before restart"), the reserved-actor labels
// (panel / local-ui — the server maps the same ids at ingest), and the
// automation/user actor fallbacks, so the device-mode feed and the cloud feed
// never disagree about the shared vocabulary.
import assert from "node:assert";
import { BEFORE_RESTART, deviceEventToActivity, normalizeSnapshotEvents } from "../src/app/device/device-activity";
import { formatInitiator } from "../src/app/pages/dashboard/widgets/initiator";
import { EVENT_ACTION_MEANINGS, RESERVED_ACTOR_LABELS, type SnapshotEvent } from "../src/lib/index";

const routeName = (id: number) => `Route ${id}`;

// normalizeSnapshotEvents: trusted timestamps pass through untouched.
{
  const evts: SnapshotEvent[] = [
    { ts: 1000, up: 60, route: 0, action: "START", origin: "MANUAL", actor: "panel", reason: "" },
    { ts: 900, up: 30, route: 0, action: "STOP", origin: "MANUAL", actor: "local-ui", reason: "MANUAL" },
  ];
  const out = normalizeSnapshotEvents(evts, Date.now());
  assert.equal(out, evts, "all-trusted ring returned as-is");
}

// normalizeSnapshotEvents: ts 0 (untrusted clock) is placed relative to the
// newest event's uptime against the snapshot's receipt time.
{
  const received = 1_700_000_000_000; // ms
  const evts: SnapshotEvent[] = [
    { ts: 0, up: 100, route: -1, action: "STOP_ALL", origin: "MANUAL", actor: "panel", reason: "" },
    { ts: 0, up: 40, route: 1, action: "START", origin: "AUTOMATION", actor: "auto123", reason: "" },
  ];
  const out = normalizeSnapshotEvents(evts, received);
  assert.equal(out[0].ts, Math.round(received / 1000), "newest event ≈ receipt time");
  assert.equal(out[1].ts, Math.round(received / 1000) - 60, "older event placed by the uptime offset");
  assert.equal(out[0].up, 100, "uptime fields preserved");
  assert.notEqual(out, evts, "a new array is returned");
}

// normalizeSnapshotEvents: an uptime ABOVE the newest event's means the event
// predates the current boot (the ring was NVS-restored across a restart). It
// stays untrusted (ts 0) instead of clamping to a bogus receipt-time "now" that
// would sort above genuinely newer rows, and the row renders BEFORE_RESTART.
{
  const received = 1_700_000_000_000; // ms
  const evts: SnapshotEvent[] = [
    { ts: 0, up: 50, route: 0, action: "START", origin: "MANUAL", actor: "panel", reason: "" },
    { ts: 0, up: 9000, route: 0, action: "STOP", origin: "MANUAL", actor: "local-ui", reason: "MANUAL" },
  ];
  const out = normalizeSnapshotEvents(evts, received);
  assert.equal(out[0].ts, Math.round(received / 1000), "current-boot event placed by the uptime offset");
  assert.equal(out[1].ts, 0, "pre-restart event left unplaced, not clamped to now");
  const row = deviceEventToActivity(out[1], routeName, {});
  assert.equal(row.ts, BEFORE_RESTART, "unplaced row renders 'before restart', not a 1970/now timestamp");
}

// normalizeSnapshotEvents: a mixed ring — trusted rows pass through, same-boot
// untrusted rows are placed against the reference, pre-restart rows stay 0.
{
  const received = 1_700_000_000_000; // ms
  const evts: SnapshotEvent[] = [
    { ts: 1_699_999_900, up: 60, route: 0, action: "START", origin: "MANUAL", actor: "panel", reason: "" },
    { ts: 0, up: 40, route: 1, action: "STOP", origin: "AUTOMATION", actor: "auto123", reason: "TANK_FULL" },
    { ts: 0, up: 8000, route: 1, action: "START", origin: "AUTOMATION", actor: "auto123", reason: "" },
  ];
  const out = normalizeSnapshotEvents(evts, received);
  assert.equal(out[0].ts, 1_699_999_900, "trusted timestamp untouched");
  assert.equal(out[1].ts, Math.round(received / 1000) - 20, "same-boot untrusted event placed by the offset");
  assert.equal(out[2].ts, 0, "pre-restart untrusted event left unplaced");
  assert.equal(deviceEventToActivity(out[2], routeName, {}).ts, BEFORE_RESTART);
}

// Reserved actors read their shared labels and carry the DEVICE origin (bare
// chip, no "by") — these ids have no users/automations row anywhere.
{
  assert.equal(RESERVED_ACTOR_LABELS["panel"], "Panel button");
  assert.equal(RESERVED_ACTOR_LABELS["local-ui"], "On-device dashboard");
  const row = deviceEventToActivity(
    { ts: 1000, up: 5, route: 0, action: "START", origin: "MANUAL", actor: "panel", reason: "" },
    routeName, {},
  );
  assert.equal(row.actor, "Panel button");
  assert.equal(row.origin, "DEVICE");
  assert.equal(formatInitiator(row.origin, row.actor), "Panel button", "no 'by' prefix for a device source");
  assert.equal(row.label, "Route 0");
  assert.equal(row.token, "START");
  assert.equal(EVENT_ACTION_MEANINGS["START"].label, "Started");
}

// Automation actors resolve to the on-device name store; an unknown id falls
// back to a bare "Automation".
{
  const named = deviceEventToActivity(
    { ts: 1000, up: 5, route: 1, action: "START", origin: "AUTOMATION", actor: "auto123", reason: "" },
    routeName, { auto123: "Morning" },
  );
  assert.equal(named.actor, "Morning");
  assert.equal(formatInitiator(named.origin, named.actor), "Automation: Morning");

  const anon = deviceEventToActivity(
    { ts: 1000, up: 5, route: 1, action: "START", origin: "AUTOMATION", actor: "gone999", reason: "" },
    routeName, {},
  );
  assert.equal(formatInitiator(anon.origin, anon.actor), "Automation");
}

// A cloud user id has no directory on the device → raw; system-wide events
// label the controller; faults tint the row.
{
  const manual = deviceEventToActivity(
    { ts: 1000, up: 5, route: 0, action: "STOP", origin: "MANUAL", actor: "userabc123456", reason: "MANUAL" },
    routeName, {},
  );
  assert.equal(manual.actor, "userabc123456", "user id renders raw");
  assert.equal(manual.detail, "MANUAL", "reason rides as the detail");

  const all = deviceEventToActivity(
    { ts: 1000, up: 5, route: -1, action: "STOP_ALL", origin: "SYSTEM", actor: "", reason: "" },
    routeName, {},
  );
  assert.equal(all.label, "controller");
  assert.equal(all.actor, undefined, "untagged event carries no chip");

  const fault = deviceEventToActivity(
    { ts: 1000, up: 5, route: 2, action: "FAULT", origin: "SYSTEM", actor: "", reason: "NO_FLOW" },
    routeName, {},
  );
  assert.equal(fault.ok, false, "fault rows render as failures");
  assert.equal(EVENT_ACTION_MEANINGS["FAULT"].kind, "fault");
}

console.log("device-activity: all tests passed");
