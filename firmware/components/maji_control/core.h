#pragma once
// Route control kernel — PURE C++ (no esphome, no id(), no millis()). The route
// state machine, queue, dedup, command outcomes, and valve-mask math as plain data
// in / decisions out. Time (`now_ms`), sensor values, tunables, and remote-claim
// status are passed in by the shell; actuation is expressed as returned state, never
// performed here. Host-testable and portable — the safety logic the firmware depends
// on, lifted out of generated strings so it can be unit-tested.
//
// This header is a faithful port of the structures and helpers in routes.h. Field
// layout and semantics match 1:1 so behaviour is unchanged.
#include <cstddef>
#include <cstdint>
#include <map>
#include <string>
#include <vector>

namespace maji_ctl {

// Fixed (not manifest-derived) limits — mirror routes.h.
static constexpr int MAX_CONCURRENT_ROUTES = 2;
static constexpr int MAX_QUEUE_SIZE = 4;
static constexpr uint32_t DEPRESSURIZE_MS = 2000;
static constexpr int MAX_OUTCOMES = 4;
static constexpr uint32_t COMMAND_TTL_MS = 300000;  // dedup window
static constexpr int COMMAND_CAP = 64;              // dedup map ceiling

// Distinct try_route_* rc for an idempotent duplicate (a QoS1 redelivery inside the
// dedup TTL): the command already ran, so the outcome is the same success as rc 0 —
// but nothing changed, so the shell must NOT log a second control event for it. The
// shell maps it back to 0 for callers; it never indexes a result table.
static constexpr int RC_DUPLICATE = 100;

// Slot states.
enum State { ST_IDLE = 0, ST_PREPARING = 1, ST_RUNNING = 2, ST_STOPPING = 3, ST_FAULT = 4 };

// Run-origin codes (index == value; mirror ORIGIN_TOKENS in codegen-ids.ts).
enum Origin { ORIGIN_SYSTEM = 0, ORIGIN_MANUAL = 1, ORIGIN_AUTOMATION = 2 };

// --- Control-event log (the on-device "what happened" feed) ---
// Event actions (index == value; mirror EVENT_ACTION_TOKENS in codegen-ids.ts).
enum EventAction { EV_START = 0, EV_STOP = 1, EV_STOP_ALL = 2, EV_FAULT = 3 };
static constexpr int MAX_EVENTS = 10;  // ring depth; the snapshot buffer sizes for it

// One control event. POD (fixed char buffers, no std::string) so the shell can persist
// the whole ring as a single NVS blob. ts is trusted unix seconds (0 = untrusted — the
// app renders up_s then); route is -1 for non-route events (STOP_ALL).
struct ControlEvent {
  int64_t ts{0};
  uint32_t up_s{0};
  int8_t route{-1};
  uint8_t action{0};
  uint8_t origin{0};
  char actor[16]{};
  char reason[16]{};
};

// Sparse run-param override bits.
enum OverrideBit {
  OV_SOURCE_MIN = 1 << 0,
  OV_DEST_MAX = 1 << 1,
  OV_MAX_RT = 1 << 2,
  OV_DURATION = 1 << 3,
  OV_VOLUME = 1 << 4,
};

struct StopSpec {
  uint8_t override_mask{0};
  uint8_t ov_source_min_pct{0};
  uint8_t ov_dest_max_pct{0};
  uint16_t ov_max_runtime_min{0};
  uint16_t ov_target_duration_s{0};
  uint32_t ov_target_volume_l{0};
};

// Per-route static descriptor (manifest data; the shell builds the table from config).
struct Route {
  uint8_t id;
  uint16_t valve_mask;
  uint8_t source_tank;   // 0xFF = water source
  uint8_t source_ws;     // 0xFF = tank source
  uint8_t dest_tank;     // 0xFF = endpoint
  uint8_t flow_sensor;
  uint16_t conflict_mask;
  uint16_t max_runtime_s;
  uint8_t pump_idx;      // 0xFF = no pump
  uint8_t source_min_pct;
  uint8_t dest_max_pct;
  bool runtime_level_ok;
  std::string name;
};

struct RouteSlot {
  int route_id{-1};  // -1 = empty
  int state{ST_IDLE};
  uint32_t start_time{0};
  uint32_t run_start_time{0};
  uint32_t flow_active_since{0};
  uint32_t last_flow_time{0};
  uint32_t stop_time{0};
  int fault_code{0};
  int stop_reason{0};
  bool flow_confirmed{false};
  bool flow_stall_detected{false};  // flow confirmed then ceased; reason resolved by dest at stop
  float volume_at_start{0.0f};
  uint8_t override_mask{0};
  uint8_t ov_source_min_pct{0};
  uint8_t ov_dest_max_pct{0};
  uint16_t ov_max_runtime_min{0};
  uint16_t ov_target_duration_s{0};
  uint32_t ov_target_volume_l{0};
};

struct QueueEntry {
  int route_id{-1};
  StopSpec spec;
  uint8_t origin{ORIGIN_SYSTEM};
  std::string actor;
};

struct CmdOutcome {
  std::string command_id;
  std::string result;
  std::string reason;
};

// Manual / claim-driven pump guard config (one per local pump). A bare claim drives a
// pump's relay outside the per-route slots; this watches that run for dry-run / max-runtime.
struct ManualPump {
  std::string node_id;
  uint8_t relay_idx{0};   // index into the pump array (== pump_ref_count key)
  uint16_t flow_mask{0};  // bitmask of flow sensors that confirm this pump's flow (0 = none)
  uint8_t src_tank{0xFF};
  uint8_t src_min{0};
  uint32_t max_rt_ms{0};
};

// All mutable control state — owned by the shell component, mutated by the kernel.
struct ControlState {
  std::vector<Route> routes;          // the route table (manifest data)
  int num_valves{0};

  RouteSlot slots[MAX_CONCURRENT_ROUTES];
  std::vector<uint8_t> route_origin;  // sized to routes.size()
  std::vector<std::string> route_actor;

  QueueEntry queue[MAX_QUEUE_SIZE];
  int queue_head{0};
  int queue_count{0};

  uint16_t commanded_valve_mask{0};

  std::map<std::string, uint32_t> processed_commands;
  CmdOutcome outcomes[MAX_OUTCOMES];
  uint8_t outcome_head{0};

  // Last MAX_EVENTS control events, newest first (events[0] = newest).
  // MAIN-LOOP ONLY: record_event (via the shell's log_event_) and the snapshot reader
  // both run unsynchronized on the ESPHome main loop — command dispatch (MQTT
  // on_message, panel binary_sensor lambdas), the local-UI glue (defer_to_loop), the
  // automation tick, and the tick_2s fault diff are all loop-thread. Never call
  // start_route/stop_route/stop_all (or record_event directly) off the main loop.
  ControlEvent events[MAX_EVENTS];
  uint8_t event_count{0};

  // Manual / claim-driven pump guard (parallel arrays, sized to manual_pumps).
  std::vector<ManualPump> manual_pumps;
  std::vector<int> manual_latch;          // 0 ok, else a STOP_* reason
  std::vector<uint32_t> manual_run_since;
  std::vector<uint32_t> manual_last_flow;

  // Load the route table and reset slots (call once at setup).
  void init(std::vector<Route> table, int valves);
  // Load the manual-pump table and reset its latch state (call once at setup).
  void set_manual_pumps(std::vector<ManualPump> pumps);
};

// --- Slot helpers ---
void init_slot(ControlState &cs, int s);
int find_free_slot(const ControlState &cs);
int find_slot_by_route(const ControlState &cs, int rid);

// --- Conflict / refcount / derived state ---
bool has_conflict(const ControlState &cs, int rid);
int pump_ref_count(const ControlState &cs, uint8_t pump_idx);
int derived_system_state(const ControlState &cs);

// --- Attribution ---
void bind_route_actor(ControlState &cs, int route_id, uint8_t origin, const std::string &actor);

// --- Valve mask math ---
// `claim_valve_bits`: bit i set if valve i has a live remote claim (shell computes
// from maji_claims). now_ms drives the depressurize window after STOPPING/FAULT.
uint16_t valve_claim_mask(const ControlState &cs, int s, uint32_t now_ms);
uint16_t desired_valve_mask(const ControlState &cs, uint32_t now_ms, uint16_t claim_valve_bits);

// --- Queue ---
bool queue_push(ControlState &cs, int rid, const StopSpec &spec, uint8_t origin, const std::string &actor);
QueueEntry queue_pop(ControlState &cs);
int queue_peek(const ControlState &cs, int i);

// --- Command dedup (now_ms injected; TTL + cap eviction) ---
bool is_duplicate_command(ControlState &cs, const std::string &command_id, uint32_t now_ms);

// --- Command outcomes (ring buffer) ---
void record_outcome(ControlState &cs, const std::string &command_id, const std::string &result,
                    const std::string &reason);

// --- Control-event ring ---
// Push an event at the head (newest-first), dropping the oldest past MAX_EVENTS.
// actor/reason are truncated to the POD field width.
void record_event(ControlState &cs, int64_t ts, uint32_t up_s, int route, uint8_t action,
                  uint8_t origin, const char *actor, const char *reason);
// True when prev->cur is a fresh fault latch. The shell diffs slot states each tick
// because faults latch inside the kernel (tick_2s) — there is no command choke point.
bool is_fault_transition(int prev, int cur);
// POD pack/unpack for the shell's NVS blob (the flash I/O itself stays in the shell).
// pack returns the entry count written (min(event_count, cap)).
uint8_t events_pack(const ControlState &cs, ControlEvent *out, int cap);
void events_unpack(ControlState &cs, const ControlEvent *in, uint8_t count);

// Escape a string for a JSON value (quotes/backslashes, drop control chars) into the
// caller's buffer. Reentrant — use this anywhere that can run off the main loop (e.g.
// the local-UI command handler on the httpd task, where the snapshot builder could
// concurrently be mid-escape on the static buffer below).
void json_esc_to(char *dst, size_t cap, const char *s);

// Same escape into a single shared static buffer — main loop only, and consume it
// immediately (one field at a time).
const char *json_esc(const char *s);

// Fault / stop-reason codes (mirror routes.h).
enum Fault { FAULT_NONE = 0, FAULT_NO_FLOW = 1, FAULT_MAX_RUNTIME = 2, FAULT_CONTROL_LOST = 3 };
enum StopReason {
  STOP_NONE = 0, STOP_MANUAL = 1, STOP_TANK_FULL = 2, STOP_NO_FLOW = 3, STOP_MAX_RUNTIME = 4,
  STOP_CONTROL_LOST = 5, STOP_SOURCE_LOW = 6, STOP_VOLUME_REACHED = 7, STOP_DURATION_REACHED = 8,
  STOP_FLOW_STALLED = 9,  // flow ceased on an open (non-tank) endpoint: clean stop, warning tier
};
static constexpr int FAULT_TO_STOP_OFFSET = 2;

// Per-route live tunable values the shell snapshots from number entities (the
// get_route_* getters in routes.h). Indexed by route id.
struct RouteTunables {
  uint32_t travel_ms{15000};      // get_route_travel_ms (max valve travel)
  uint8_t source_min_pct{0};
  uint8_t dest_max_pct{0};
  uint16_t max_runtime_s{1800};
  uint16_t target_duration_s{0};
  uint32_t target_volume_l{0};
  uint8_t flow_stall_enable{0};
};

// Everything the kernel reads from the outside world this tick. The shell fills it
// from id(...) once per tick; the kernel reads only this (no id(), no millis()).
// Sensor vectors are indexed by tank/flow-sensor index; a value < 0 or NaN = unavailable.
struct Inputs {
  uint32_t now_ms{0};
  bool safety_override{false};
  uint32_t flow_watchdog_ms{0};
  uint32_t flow_confirm_ms{0};
  float flow_threshold_l_min{0};
  std::vector<float> tank_levels;
  std::vector<float> flow_rates;
  std::vector<float> flow_totals;
  std::vector<RouteTunables> route_tunables;  // by route id
  uint16_t claim_valve_bits{0};               // remote valve claims (bit i)
  uint32_t manual_claim_bits{0};              // bit k = manual pump k has a live claim
};

// Effective run-params: slot override (when its bit is set) else the route's live tunable.
uint8_t effective_source_min_pct(const ControlState &cs, const Inputs &in, int s);
uint8_t effective_dest_max_pct(const ControlState &cs, const Inputs &in, int s);
uint16_t effective_max_runtime_s(const ControlState &cs, const Inputs &in, int s);
uint16_t effective_target_duration_s(const ControlState &cs, const Inputs &in, int s);
uint32_t effective_target_volume_l(const ControlState &cs, const Inputs &in, int s);

// Live run facts for the dashboard's card-as-progress-bar (a RUNNING slot only). The
// device reports facts; the app computes the fraction + labels (so the UX is tunable
// without reflashing). Empty/sentinel values when a target/sensor is absent.
// delivered is the stop-decision basis (float total - volume_at_start), so the bar
// reaches 100% exactly when the run hits its volume target. Level progress is NOT here:
// the app already receives the dest tank's level channel and uses it against target_lvl.
struct RunLive {
  int32_t delivered_l;    // litres so far; -1 if unmetered
  uint32_t elapsed_s;     // run elapsed seconds
  uint32_t target_vol_l;  // effective volume target; 0 if none
  uint32_t target_dur_s;  // effective duration target; 0 if none
  int16_t target_lvl_pct; // effective dest-level target; -1 if none
};
RunLive run_live(const ControlState &cs, const Inputs &in, int s);

// Pre-start guard. 0 ok, 3 source-low, 4 dest-full. safety_override bypasses.
int check_precheck(const Inputs &in, uint8_t src_idx, uint8_t src_min, uint8_t dst_idx, uint8_t dst_max);

// Set a free slot to PREPARING for a route, carrying its run-param override.
void activate_slot(ControlState &cs, int slot, int route_id, const StopSpec &spec, uint8_t origin,
                   const std::string &actor, uint32_t now_ms);

// Start: 0 started, 1 queued, 2 rejected (invalid/duplicate/active/full), 3 source-low,
// 4 dest-full, RC_DUPLICATE idempotent replay within the dedup TTL (no state change —
// same success outcome as 0, but the shell skips the event log for it).
int try_route_start(ControlState &cs, const Inputs &in, int route_id, const std::string &command_id,
                    const StopSpec &spec, uint8_t origin, const std::string &actor);
// Stop: 0 stopping, 1 not active, 2 already stopping/idle/faulted, RC_DUPLICATE as above.
int try_route_stop(ControlState &cs, int route_id, const std::string &command_id, uint8_t origin,
                   const std::string &actor, uint32_t now_ms);

// SHELL CONTRACT (preserves parity with the old control.ts loops — verified by source diff):
//   1s tick, in order:  tick_1s(cs,in)  ->  manual_pump_guard_tick(cs,in) + apply pump need
//     (pump_ref_count(i)>0 || (claim_i && manual_claim_ok(k)))  ->  id(system_state)=derived_system_state
//     ->  active_slot = first slot in state 1..3  ->  id(stop_reason)=TickResult.stop_reason_on_idle (if !=-1)
//     ->  reconcile valves to desired_valve_mask(cs, now, claim_valve_bits).
//     Pump mgmt MUST run after tick_1s so a slot that became RUNNING this tick is counted.
//   2s tick:  resolve flow_watchdog/confirm/threshold (>=5s/>=3s/>=0.1 floors else DEFAULT) into `in`,
//     call tick_2s(cs,in), then stop_valve_hw(i) for each bit in WatchdogResult.fault_resync_valves.
//   Inputs.flow_rates MUST be sized to the flow-sensor count; route_tunables indexed by route id.

// 1s transitions: PREPARING->RUNNING, STOPPING->IDLE, queue drain.
struct TickResult {
  bool transitioned{false};
  int stop_reason_on_idle{-1};  // a slot reached IDLE this tick -> publish id(stop_reason) (-1 = none)
};
TickResult tick_1s(ControlState &cs, const Inputs &in);

// 2s safety monitor: flow/dry-run, level, intent stops, max runtime, fault, tank-full.
struct WatchdogResult {
  uint16_t fault_resync_valves{0};  // valves to stop_valve_hw this tick (cover position resync on fault)
};
WatchdogResult tick_2s(ControlState &cs, const Inputs &in);

// --- Manual / claim-driven pump guard ---
// A bare claim (manual node_set or a peer) drives a local pump's relay outside the
// per-route slots; this guards that run (dry-run on the pump's flow sensors + max
// runtime) and latches the pump on a trip so the shell gates its claim off until
// released / reset. safety_override bypasses the guard.
int manual_pump_slot(const ControlState &cs, const std::string &node_id);
bool manual_claim_ok(const ControlState &cs, const Inputs &in, int k);
void manual_clear_latch(ControlState &cs, int k);
void manual_clear_all_latches(ControlState &cs);
// NODE_SET pre-check rc: 0 ok, 1 source-low, 2 no local flow sensor (dry-run unprotectable).
int manual_pump_precheck(const ControlState &cs, const Inputs &in, int k);
// 1s guard tick — latch claim-only pump runs that go dry / overrun.
void manual_pump_guard_tick(ControlState &cs, const Inputs &in);

}  // namespace maji_ctl
