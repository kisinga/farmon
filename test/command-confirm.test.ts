/**
 * Command confirmation descriptor tests — the single (action, entity) → phase
 * table that drives every dashboard control's pending/confirmed/refused feedback.
 *
 * The dead-man (sustained node_set) cases are the regression guard: a held
 * actuator must auto-release on STATE divergence (online + past-grace + not
 * running, including no row at all), not wait for a REFUSED event.
 *
 * Usage: npm run test:confirm
 */
import {
  confirmDescriptor, HOLD_GRACE_MS, HOLD_RECLAIM_MS, CLAIM_LEASE_FLOOR_S, COMMAND_TTL_S,
  type ConfirmObservation,
  type RouteControl, type ActuatorControl, type SetpointControl,
} from "@core";

let passed = 0;
let failed = 0;
function assert(condition: boolean, name: string, detail?: string) {
  if (condition) { console.log(`  ✓ ${name}`); passed++; }
  else { console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`); failed++; }
}

const TTL_MS = COMMAND_TTL_S * 1000;
const route: RouteControl = { routeId: 0, name: "R" };
const pump: ActuatorControl = { id: "pump1", name: "Pump", kind: "pump", reportedSensor: "pump1_relay" };
const setpoint: SetpointControl = {
  key: "route_0_source_min_pct", routeId: 0, routeName: "R", field: "source_min_pct",
  label: "Source min", default: 20, min: 0, max: 100, unit: "%",
};
/** Build an observation with sane defaults (online, fresh). */
function obs(o: Partial<ConfirmObservation> = {}): ConfirmObservation {
  return { ageMs: 0, online: true, ...o };
}

// --- Routes ----------------------------------------------------------------
{
  const d = confirmDescriptor("route_start", { route });
  assert(d.classify(obs({ reportedText: "RUNNING" })).phase === "confirmed", "route_start RUNNING → confirmed");
  assert(d.classify(obs({ reportedText: "PREPARING" })).phase === "confirmed", "route_start PREPARING → confirmed (device acted)");
  assert(d.classify(obs({ reportedText: "IDLE" })).phase === "pending", "route_start IDLE → pending (not reflected yet)");
  const ref = d.classify(obs({ correlated: { to: "REFUSED", reason: "SOURCE_LOW" } }));
  assert(ref.phase === "refused" && ref.reason === "SOURCE_LOW", "route_start REFUSED event → refused + reason");
  assert(d.classify(obs({ correlated: { to: "QUEUED", reason: "" } })).phase === "confirmed", "route_start QUEUED → confirmed (applied)");
  assert(d.classify(obs({ reportedText: "IDLE", ageMs: TTL_MS + 1 })).phase === "expired", "route_start past TTL → expired");
}
{
  const d = confirmDescriptor("route_stop", { route });
  assert(d.classify(obs({ reportedText: "STOPPING" })).phase === "confirmed", "route_stop STOPPING → confirmed");
  assert(d.classify(obs({ reportedText: "IDLE" })).phase === "confirmed", "route_stop IDLE → confirmed");
  assert(d.classify(obs({ reportedText: "RUNNING" })).phase === "pending", "route_stop RUNNING → pending");
  assert(d.classify(obs({ correlated: { to: "REFUSED", reason: "NOT_RUNNING" } })).phase === "refused", "route_stop NOT_RUNNING → refused");
}
{
  const d = confirmDescriptor("fault_reset", { route });
  assert(d.classify(obs({ reportedText: "IDLE" })).phase === "confirmed", "fault_reset leaves FAULT → confirmed");
  assert(d.classify(obs({ reportedText: "FAULT" })).phase === "pending", "fault_reset still FAULT → pending");
}

// --- config_set (numeric convergence, no event) ----------------------------
{
  const d = confirmDescriptor("config_set", { setpoint, value: 40 });
  assert(d.sensor === setpoint.key, "config_set watches the setpoint sensor");
  assert(d.classify(obs({ reported: 40 })).phase === "confirmed", "config_set reported==value → confirmed");
  assert(d.classify(obs({ reported: 40.4 })).phase === "confirmed", "config_set rounds (40.4≈40) → confirmed");
  assert(d.classify(obs({ reported: 38 })).phase === "pending", "config_set reported!=value → pending");
  assert(d.classify(obs({ reported: 38, ageMs: TTL_MS + 1 })).phase === "expired", "config_set past TTL → expired");
}

// --- Dead-man (sustained node_set on) — THE regression guard ---------------
{
  const d = confirmDescriptor("node_set", { actuator: pump, on: true });
  assert(d.sustained === true, "node_set on is sustained");
  assert(d.classify(obs({ reported: 1 })).phase === "confirmed", "claim reported on → confirmed");
  assert(d.classify(obs({ correlated: { to: "APPLIED", reason: "" } })).phase === "confirmed", "claim APPLIED event → confirmed");
  assert(d.classify(obs({ reported: 0, ageMs: 5_000 })).phase === "pending", "claim not-on within grace → pending");
  assert(d.classify(obs({ reported: 0, ageMs: HOLD_GRACE_MS + 1_000 })).phase === "refused", "claim not-on past grace (online) → refused (blocked)");
  assert(d.classify(obs({ reported: undefined, ageMs: HOLD_GRACE_MS + 1_000 })).phase === "refused", "claim NO ROW past grace (online) → refused (matches reconcileHeld)");
  assert(d.classify(obs({ reported: 0, ageMs: HOLD_GRACE_MS + 1_000, online: false })).phase === "pending", "claim not-on past grace OFFLINE → pending (never auto-release offline)");
  const ref = d.classify(obs({ reported: 0, ageMs: HOLD_GRACE_MS + 1_000, correlated: { to: "REFUSED", reason: "NO_FLOW" } }));
  assert(ref.phase === "refused" && ref.reason === "NO_FLOW", "claim REFUSED event supplies the reason");
}
{
  const d = confirmDescriptor("node_set", { actuator: pump, on: false });
  assert(d.sustained === false, "node_set off is not sustained");
  assert(d.classify(obs({ reported: 0 })).phase === "confirmed", "release reported off → confirmed");
  assert(d.classify(obs({ reported: undefined })).phase === "confirmed", "release no row → confirmed (absence == off)");
  assert(d.classify(obs({ reported: 1 })).phase === "pending", "release still on → pending");
}

// --- Bool switches ---------------------------------------------------------
{
  const on = confirmDescriptor("safety_override", { on: true });
  assert(on.classify(obs({ reported: 1 })).phase === "confirmed", "override on, reported on → confirmed");
  assert(on.classify(obs({ reported: 0 })).phase === "pending", "override on, reported off → pending");
}

// --- Fan-out / fire-and-forget (named exceptions) --------------------------
{
  const d = confirmDescriptor("stop_all");
  assert(d.sensor === undefined && d.sustained === false, "stop_all has no convergence channel");
  assert(d.classify(obs()).phase === "confirmed", "stop_all → confirmed once accepted");
}

// --- Lease-floor guard: the re-claim cadence can't be raised above a safe
//     fraction of the minimum possible lease (the dead-man hardening). --------
assert(HOLD_RECLAIM_MS * 2 <= CLAIM_LEASE_FLOOR_S * 1000, "HOLD_RECLAIM_MS ≤ half the claim_lease_s floor");

console.log(`\n${"=".repeat(40)}`);
console.log(`${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
