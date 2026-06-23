// Host tests for the pure control kernel (firmware/components/maji_control/core.cpp).
// Characterizes the route-state-machine leaf logic (slot helpers, conflict, pump
// refcount, derived state, valve-mask math, queue, dedup, outcomes) so the port from
// routes.h is provably behaviour-preserving and stays that way.
//
//   bash firmware/test/run-host-tests.sh
#include "core.h"
#include <cstdio>

using namespace maji_ctl;

static int pass = 0, fail = 0;
static void check(bool c, const char *name) {
  if (c) { printf("  ok   %s\n", name); pass++; }
  else { printf("  FAIL %s\n", name); fail++; }
}

// Three routes: r0 (valve bit0, pump0) <-> r1 (valve bit1, pump0) conflict; r2 (valve bit2, pump1) free.
static ControlState make_state() {
  ControlState cs;
  std::vector<Route> t(3);
  t[0].id = 0; t[0].valve_mask = 0b001; t[0].pump_idx = 0; t[0].conflict_mask = (1 << 1);
  t[1].id = 1; t[1].valve_mask = 0b010; t[1].pump_idx = 0; t[1].conflict_mask = (1 << 0);
  t[2].id = 2; t[2].valve_mask = 0b100; t[2].pump_idx = 1; t[2].conflict_mask = 0;
  cs.init(std::move(t), 3);
  return cs;
}

// Put route `rid` into `state` in slot `s`.
static void occupy(ControlState &cs, int s, int rid, int state) {
  cs.slots[s].route_id = rid;
  cs.slots[s].state = state;
}

// Two conflicting routes sharing flow sensor 0, tank0 -> tank1, with runtime level checks.
static ControlState scenario_state() {
  ControlState cs;
  std::vector<Route> t(2);
  t[0].id = 0; t[0].valve_mask = 0b01; t[0].pump_idx = 0; t[0].flow_sensor = 0;
  t[0].source_tank = 0; t[0].dest_tank = 1; t[0].runtime_level_ok = true; t[0].conflict_mask = (1 << 1);
  t[1].id = 1; t[1].valve_mask = 0b10; t[1].pump_idx = 0; t[1].flow_sensor = 0;
  t[1].source_tank = 0; t[1].dest_tank = 1; t[1].runtime_level_ok = true; t[1].conflict_mask = (1 << 0);
  cs.init(std::move(t), 2);
  return cs;
}

// Healthy inputs: source/dest mid-level, flow present, 2s travel, generous watchdogs.
static Inputs mk_inputs(uint32_t now) {
  Inputs in;
  in.now_ms = now;
  in.flow_watchdog_ms = 10000;
  in.flow_confirm_ms = 3000;
  in.flow_threshold_l_min = 1.0f;
  in.tank_levels = {50.0f, 50.0f};
  in.flow_rates = {5.0f};
  in.flow_totals = {0.0f};
  RouteTunables t0;
  t0.travel_ms = 2000; t0.source_min_pct = 20; t0.dest_max_pct = 90; t0.max_runtime_s = 1800;
  RouteTunables t1 = t0;
  in.route_tunables = {t0, t1};
  return in;
}

int main() {
  // --- init / find ---
  {
    ControlState cs = make_state();
    check(cs.slots[0].route_id == -1 && cs.slots[0].state == ST_IDLE, "init: slots empty/IDLE");
    check(find_free_slot(cs) == 0, "find_free_slot: 0 when all idle");
    occupy(cs, 0, 0, ST_RUNNING);
    check(find_free_slot(cs) == 1, "find_free_slot: 1 when slot0 busy");
    check(find_slot_by_route(cs, 0) == 0, "find_slot_by_route: hit");
    check(find_slot_by_route(cs, 2) == -1, "find_slot_by_route: miss");
    occupy(cs, 1, 2, ST_PREPARING);
    check(find_free_slot(cs) == -1, "find_free_slot: -1 when full");
  }

  // --- conflict ---
  {
    ControlState cs = make_state();
    occupy(cs, 0, 1, ST_RUNNING);  // r1 running
    check(has_conflict(cs, 0), "conflict: r0 conflicts with running r1");
    check(!has_conflict(cs, 2), "conflict: r2 free of r1");
    cs.slots[0].state = ST_STOPPING;  // stopping no longer conflicts
    check(!has_conflict(cs, 0), "conflict: STOPPING slot does not conflict");
  }

  // --- pump refcount (RUNNING only) ---
  {
    ControlState cs = make_state();
    occupy(cs, 0, 0, ST_RUNNING);   // pump0
    occupy(cs, 1, 2, ST_RUNNING);   // pump1
    check(pump_ref_count(cs, 0) == 1, "pump_ref_count: pump0 == 1");
    check(pump_ref_count(cs, 1) == 1, "pump_ref_count: pump1 == 1");
    cs.slots[0].state = ST_PREPARING;  // not RUNNING -> not counted
    check(pump_ref_count(cs, 0) == 0, "pump_ref_count: PREPARING not counted");
  }

  // --- derived system state (FAULT wins, else max) ---
  {
    ControlState cs = make_state();
    occupy(cs, 0, 0, ST_RUNNING);
    occupy(cs, 1, 2, ST_PREPARING);
    check(derived_system_state(cs) == ST_RUNNING, "derived: max(RUNNING,PREPARING)=RUNNING");
    cs.slots[1].state = ST_FAULT;
    check(derived_system_state(cs) == ST_FAULT, "derived: FAULT wins");
  }

  // --- valve mask + depressurize window + remote claim bits ---
  {
    ControlState cs = make_state();
    occupy(cs, 0, 0, ST_RUNNING);  // claims valve bit0
    check(desired_valve_mask(cs, 1000, 0) == 0b001, "valve: RUNNING claims its mask");
    cs.slots[0].state = ST_STOPPING;
    cs.slots[0].stop_time = 1000;
    check(desired_valve_mask(cs, 1500, 0) == 0b001, "valve: held during depressurize window");
    check(desired_valve_mask(cs, 1000 + DEPRESSURIZE_MS + 1, 0) == 0, "valve: released after window");
    check(desired_valve_mask(cs, 9999, 0b100) == 0b100, "valve: remote claim bits OR in");
  }

  // --- queue: push/pop FIFO, wraparound, full ---
  {
    ControlState cs = make_state();
    check(queue_push(cs, 0, StopSpec{}, ORIGIN_MANUAL, "a"), "queue: push 0");
    check(queue_push(cs, 1, StopSpec{}, ORIGIN_SYSTEM, "b"), "queue: push 1");
    check(queue_peek(cs, 0) == 0 && queue_peek(cs, 1) == 1, "queue: peek order");
    check(queue_peek(cs, 5) == -1, "queue: peek out of range");
    check(queue_pop(cs).route_id == 0, "queue: pop FIFO 0");
    check(queue_pop(cs).route_id == 1, "queue: pop FIFO 1");
    check(queue_pop(cs).route_id == -1, "queue: pop empty");
    for (int i = 0; i < MAX_QUEUE_SIZE; i++) check(queue_push(cs, i, StopSpec{}, 0, ""), "queue: fill");
    check(!queue_push(cs, 9, StopSpec{}, 0, ""), "queue: push rejected when full");
    check(queue_pop(cs).route_id == 0, "queue: wraparound pop");
  }

  // --- command dedup: first-seen, replay, TTL expiry, cap eviction ---
  {
    ControlState cs = make_state();
    check(!is_duplicate_command(cs, "cmd1", 0), "dedup: first seen -> not dup");
    check(is_duplicate_command(cs, "cmd1", 1000), "dedup: replay within TTL -> dup");
    check(!is_duplicate_command(cs, "cmd1", COMMAND_TTL_MS + 2), "dedup: re-seen after TTL -> not dup");
    check(!is_duplicate_command(cs, "", 5), "dedup: empty id never dup");

    ControlState cs2 = make_state();
    for (int i = 0; i < COMMAND_CAP; i++) is_duplicate_command(cs2, "c" + std::to_string(i), i);
    check(is_duplicate_command(cs2, "c1", 100), "dedup: c1 present before cap eviction");
    is_duplicate_command(cs2, "cNEW", 100);  // size==cap -> evicts oldest (c0)
    check(!is_duplicate_command(cs2, "c0", 100), "dedup: oldest evicted at cap");
  }

  // --- outcomes ring ---
  {
    ControlState cs = make_state();
    record_outcome(cs, "id1", "APPLIED", "");
    check(cs.outcomes[0].command_id == "id1" && cs.outcomes[0].result == "APPLIED", "outcome: recorded");
    record_outcome(cs, "", "X", "Y");  // empty id ignored
    check(cs.outcome_head == 1, "outcome: empty command_id ignored");
    for (int i = 0; i < MAX_OUTCOMES; i++) record_outcome(cs, "r" + std::to_string(i), "OK", "");
    check(cs.outcome_head == (1 + MAX_OUTCOMES) % MAX_OUTCOMES, "outcome: head wraps");
  }

  // ===================================================================================
  // Scenario tests — the full state machine through try_route_start/stop + tick_1s/2s.
  // These are the safety gate: dry-run guard, lease/level/duration/max-runtime, faults.
  // ===================================================================================

  // --- happy path: start -> PREPARING -> (travel) RUNNING -> stop -> (close) IDLE ---
  {
    ControlState cs = scenario_state();
    int rc = try_route_start(cs, mk_inputs(1000), 0, "c1", StopSpec{}, ORIGIN_MANUAL, "jane");
    check(rc == 0 && cs.slots[0].state == ST_PREPARING, "lifecycle: start -> PREPARING");

    tick_1s(cs, mk_inputs(3000));  // before travel(2000)+1000 elapsed from start(1000)
    check(cs.slots[0].state == ST_PREPARING, "lifecycle: PREPARING before travel done");
    tick_1s(cs, mk_inputs(4001));  // now-start(1000) > 3000
    check(cs.slots[0].state == ST_RUNNING, "lifecycle: PREPARING -> RUNNING after travel");

    WatchdogResult w = tick_2s(cs, mk_inputs(5000));
    check(cs.slots[0].state == ST_RUNNING && w.fault_resync_valves == 0, "lifecycle: healthy stays RUNNING");

    int sc = try_route_stop(cs, 0, "c2", ORIGIN_MANUAL, "jane", 6000);
    check(sc == 0 && cs.slots[0].state == ST_STOPPING, "lifecycle: stop -> STOPPING");
    tick_1s(cs, mk_inputs(9000));  // before stop(6000)+depress(2000)+travel(2000)+1000=11000
    check(cs.slots[0].state == ST_STOPPING, "lifecycle: STOPPING before close done");
    TickResult t = tick_1s(cs, mk_inputs(11001));
    check(cs.slots[0].state == ST_IDLE && cs.slots[0].route_id == -1, "lifecycle: STOPPING -> IDLE");
    check(t.stop_reason_on_idle == STOP_MANUAL, "lifecycle: stop_reason=MANUAL surfaced on IDLE");
  }

  // --- pre-start dry guards: source-low rejects; safety_override bypasses ---
  {
    ControlState cs = scenario_state();
    Inputs lo = mk_inputs(1000);
    lo.tank_levels = {10.0f, 50.0f};  // source below src_min(20)
    check(try_route_start(cs, lo, 0, "d1", StopSpec{}, ORIGIN_MANUAL, "") == 3 && find_slot_by_route(cs, 0) == -1,
          "precheck: source-low rejects with 3, no slot");
    lo.safety_override = true;
    check(try_route_start(cs, lo, 0, "d2", StopSpec{}, ORIGIN_MANUAL, "") == 0,
          "precheck: safety_override bypasses source-low");
  }

  // --- dry-run protection: confirmed-never, flow ceases past watchdog -> FAULT_NO_FLOW ---
  {
    ControlState cs = scenario_state();
    try_route_start(cs, mk_inputs(1000), 0, "f1", StopSpec{}, ORIGIN_MANUAL, "");
    tick_1s(cs, mk_inputs(4001));  // -> RUNNING (run_start=4001, last_flow=4001)
    Inputs dry = mk_inputs(4001 + 10002);  // runtime 10002 > flow_watchdog 10000
    dry.flow_rates = {0.0f};                // and no flow ever confirmed
    WatchdogResult w = tick_2s(cs, dry);
    check(cs.slots[0].state == ST_FAULT && cs.slots[0].fault_code == FAULT_NO_FLOW, "watchdog: dry-run -> FAULT_NO_FLOW");
    check((w.fault_resync_valves & 0b01) != 0, "watchdog: fault resyncs the route's valves");
    check(cs.slots[0].stop_reason == FAULT_NO_FLOW + FAULT_TO_STOP_OFFSET, "watchdog: stop_reason derived from fault");
  }

  // --- destination-full mid-run -> clean STOPPING (not fault) ---
  {
    ControlState cs = scenario_state();
    try_route_start(cs, mk_inputs(1000), 0, "lv1", StopSpec{}, ORIGIN_MANUAL, "");
    tick_1s(cs, mk_inputs(4001));  // RUNNING
    Inputs full = mk_inputs(5000);
    full.tank_levels = {50.0f, 95.0f};  // dest above dst_max(90)
    tick_2s(cs, full);
    check(cs.slots[0].state == ST_STOPPING && cs.slots[0].stop_reason == STOP_TANK_FULL,
          "watchdog: dest-full -> clean STOPPING (TANK_FULL)");
  }

  // --- duration intent-stop -> clean STOPPING ---
  {
    auto durIn = [](uint32_t now) { Inputs in = mk_inputs(now); in.route_tunables[0].target_duration_s = 30; return in; };
    ControlState cs = scenario_state();
    try_route_start(cs, durIn(1000), 0, "du1", StopSpec{}, ORIGIN_MANUAL, "");
    tick_1s(cs, durIn(4001));  // RUNNING run_start=4001
    tick_2s(cs, durIn(4001 + 30000));  // runtime 30000 >= 30s
    check(cs.slots[0].state == ST_STOPPING && cs.slots[0].stop_reason == STOP_DURATION_REACHED,
          "watchdog: duration target -> clean STOPPING");
  }

  // --- max-runtime backstop -> clean STOPPING (warning, not a fault) ---
  {
    auto rtIn = [](uint32_t now) { Inputs in = mk_inputs(now); in.route_tunables[0].max_runtime_s = 20; return in; };
    ControlState cs = scenario_state();
    try_route_start(cs, rtIn(1000), 0, "mr1", StopSpec{}, ORIGIN_MANUAL, "");
    tick_1s(cs, rtIn(4001));  // RUNNING
    tick_2s(cs, rtIn(4001 + 20001));  // runtime 20001 > 20s
    check(cs.slots[0].state == ST_STOPPING && cs.slots[0].stop_reason == STOP_MAX_RUNTIME &&
          cs.slots[0].fault_code == FAULT_NONE, "watchdog: max-runtime -> clean STOPPING (warning)");
  }

  // --- conflict -> queue -> drain once the holder stops conflicting ---
  {
    ControlState cs = scenario_state();
    try_route_start(cs, mk_inputs(1000), 0, "g1", StopSpec{}, ORIGIN_MANUAL, "");        // r0 PREPARING
    int rc = try_route_start(cs, mk_inputs(1000), 1, "g2", StopSpec{}, ORIGIN_MANUAL, "");  // conflicts r0
    check(rc == 1 && cs.queue_count == 1, "queue: conflicting route queued (1)");
    tick_1s(cs, mk_inputs(4001));  // r0 -> RUNNING; r1 still blocked (RUNNING conflicts)
    check(find_slot_by_route(cs, 1) == -1 && cs.queue_count == 1, "queue: held while r0 RUNNING");
    try_route_stop(cs, 0, "g3", ORIGIN_MANUAL, "", 5000);  // r0 STOPPING -> no longer conflicts
    tick_1s(cs, mk_inputs(6000));  // slot1 free + no conflict -> drain r1
    check(find_slot_by_route(cs, 1) != -1 && cs.queue_count == 0, "queue: drains r1 once r0 stops conflicting");
  }

  // --- stop result codes + idempotency ---
  {
    ControlState cs = scenario_state();
    check(try_route_stop(cs, 0, "s1", ORIGIN_MANUAL, "", 1000) == 1, "stop: not active -> 1");
    try_route_start(cs, mk_inputs(1000), 0, "s2", StopSpec{}, ORIGIN_MANUAL, "");
    try_route_stop(cs, 0, "s3", ORIGIN_MANUAL, "", 2000);  // -> STOPPING
    check(try_route_stop(cs, 0, "s4", ORIGIN_MANUAL, "", 2500) == 2, "stop: already STOPPING -> 2");
    check(try_route_stop(cs, 0, "s3", ORIGIN_MANUAL, "", 2600) == 0, "stop: duplicate command_id -> 0");
  }

  // --- manual / claim-driven pump guard ---
  // Inputs for a claim-only run: now, flow rate on sensor 0, claim present on pump 0.
  auto mp_in = [](uint32_t now, float flow, bool claim) {
    Inputs in;
    in.now_ms = now;
    in.flow_watchdog_ms = 10000;
    in.flow_threshold_l_min = 1.0f;
    in.flow_rates = {flow};
    in.tank_levels = {50.0f};
    in.manual_claim_bits = claim ? 1u : 0u;
    return in;
  };
  {
    // one guarded pump (flow sensor 0, source tank 0 min 20, max-runtime 60s)
    ControlState cs;
    cs.init({}, 1);
    cs.set_manual_pumps({ManualPump{"pumpA", 0, 0b1, 0, 20, 60000}});

    check(manual_pump_slot(cs, "pumpA") == 0 && manual_pump_slot(cs, "nope") == -1, "manual: slot lookup");

    // dry-run: claim held, flow never arrives past the watchdog -> latch STOP_NO_FLOW
    manual_pump_guard_tick(cs, mp_in(1000, 0.0f, true));
    check(cs.manual_latch[0] == 0, "manual: no latch before watchdog");
    manual_pump_guard_tick(cs, mp_in(1000 + 10001, 0.0f, true));
    check(cs.manual_latch[0] == STOP_NO_FLOW, "manual: dry-run latches STOP_NO_FLOW");
    check(!manual_claim_ok(cs, mp_in(20000, 0.0f, true), 0), "manual: claim_ok false while latched");
    // claim drops -> latch + run cleared
    manual_pump_guard_tick(cs, mp_in(21000, 0.0f, false));
    check(cs.manual_latch[0] == 0 && cs.manual_run_since[0] == 0, "manual: claim drop clears latch");
  }
  {
    // healthy flow never latches; overrun latches STOP_MAX_RUNTIME
    ControlState cs;
    cs.init({}, 1);
    cs.set_manual_pumps({ManualPump{"pumpA", 0, 0b1, 0, 20, 60000}});
    manual_pump_guard_tick(cs, mp_in(1000, 5.0f, true));
    manual_pump_guard_tick(cs, mp_in(1000 + 11000, 5.0f, true));
    check(cs.manual_latch[0] == 0, "manual: healthy flow no latch past watchdog");
    manual_pump_guard_tick(cs, mp_in(1000 + 60001, 5.0f, true));
    check(cs.manual_latch[0] == STOP_MAX_RUNTIME, "manual: overrun latches STOP_MAX_RUNTIME");
  }
  {
    // safety_override: never latches, resets the run timer
    ControlState cs;
    cs.init({}, 1);
    cs.set_manual_pumps({ManualPump{"pumpA", 0, 0b1, 0, 20, 60000}});
    Inputs so = mp_in(1000, 0.0f, true);
    so.safety_override = true;
    manual_pump_guard_tick(cs, so);
    check(cs.manual_latch[0] == 0 && cs.manual_run_since[0] == 0, "manual: safety_override never latches");
  }
  {
    // node_set pre-check: source-low (1), no-flow-sensor (2), ok (0), override (0)
    ControlState cs;
    cs.init({}, 1);
    cs.set_manual_pumps({ManualPump{"pumpA", 0, 0b1, 0, 20, 60000}, ManualPump{"pumpB", 1, 0, 0xFF, 0, 60000}});
    Inputs p = mp_in(0, 0.0f, false);
    p.tank_levels = {10.0f};  // source below min 20
    check(manual_pump_precheck(cs, p, 0) == 1, "manual precheck: source-low -> 1");
    check(manual_pump_precheck(cs, p, 1) == 2, "manual precheck: no flow sensor -> 2");
    p.tank_levels = {50.0f};
    check(manual_pump_precheck(cs, p, 0) == 0, "manual precheck: ok -> 0");
    p.tank_levels = {10.0f};
    p.safety_override = true;
    check(manual_pump_precheck(cs, p, 0) == 0, "manual precheck: safety_override -> 0");
  }

  printf("\n%d passed, %d failed\n", pass, fail);
  return fail ? 1 : 0;
}
