#include "maji_control.h"
#include "esphome/core/hal.h"
#include "esphome/core/log.h"
#include <algorithm>
#include <cmath>
#include <cstdio>
#include <cstring>
#include <memory>

namespace esphome {
namespace maji_control {

static const char *const TAG = "maji_control";

using namespace maji_ctl;

// Wire tokens for the run ledger. Mirror the enums in core.h and the *_TOKENS arrays in
// codegen-ids.ts (the kernel stays token-agnostic; the shell maps the codes it already
// holds). Out-of-range -> the safe "NONE"/"SYSTEM" default.
static const char *origin_tok(int i) {
  static const char *const T[] = {"SYSTEM", "MANUAL", "AUTOMATION"};
  return (i >= 0 && i < 3) ? T[i] : "SYSTEM";
}
static const char *stop_tok(int i) {
  static const char *const T[] = {"NONE", "MANUAL", "TANK_FULL", "NO_FLOW", "MAX_RUNTIME",
                                  "CONTROL_LOST", "SOURCE_LOW", "VOLUME_REACHED", "DURATION_REACHED"};
  return (i >= 0 && i < 9) ? T[i] : "NONE";
}
static const char *fault_tok(int i) {
  static const char *const T[] = {"NONE", "NO_FLOW", "MAX_RUNTIME", "CONTROL_LOST"};
  return (i >= 0 && i < 4) ? T[i] : "NONE";
}

// --- Fixed POD mirror of the durable MeterState, for ESPPreference (NVS) -----------
// MeterState holds vectors + std::string, so it can't be stored raw; this bounded blob
// is the on-flash form. Sizes cap the live state (excess is dropped on save, which only
// happens past the configured maxima — unreachable on real hardware). On ESP32 the
// preferences backend is NVS; this blob is ~2 KB (OUTBOX_CAP=16), comfortably inside the
// default ~20 KB+ NVS partition, and ESPHome batches the flash write so frequent saves
// don't wear flash. (On flash-poor targets, shrink OUTBOX_CAP.)
static constexpr uint32_t METER_BLOB_KEY = 0x4D455452;   // "METR" — preferences hash
static constexpr uint32_t METER_BLOB_MAGIC = 0x4D455431; // "MET1" — format/sanity tag
static constexpr int BLOB_MAX_FLOW = 8;
static constexpr int BLOB_MAX_SLOT = MAX_CONCURRENT_ROUTES;

static void cpstr(char *dst, size_t cap, const std::string &src) {
  size_t n = (src.size() < cap - 1) ? src.size() : cap - 1;
  memcpy(dst, src.data(), n);
  dst[n] = '\0';
}

struct BlobCounter {
  uint64_t litres;
  uint32_t remainder;
  uint32_t last_raw;
  uint8_t seeded;
};
struct BlobOpen {
  uint8_t active;
  uint32_t epoch, seq;
  int32_t route, flow_sensor;
  char origin[16], actor[24];
  uint32_t start_epoch, run_start_ms;
  uint64_t start_litres;
};
struct BlobRun {
  uint32_t epoch, seq;
  int32_t route;
  char origin[16], actor[24];
  uint32_t start_epoch, end_epoch, duration_s;
  char stop_reason[20], fault[16];
  uint64_t start_litres, end_litres;
  uint8_t metered;
};
struct MeterBlob {
  uint32_t magic;
  uint32_t run_epoch, run_seq, acked_epoch, acked_seq, dropped, last_wall;
  uint8_t num_counters, num_open, outbox_count;
  BlobCounter counters[BLOB_MAX_FLOW];
  BlobOpen open[BLOB_MAX_SLOT];
  BlobRun outbox[maji_meter::OUTBOX_CAP];
};

// --- Fixed POD on-flash form of the control-event ring -------------------------
// ControlEvent is already POD, so the blob is just a count + the ring entries
// (newest-first) — ~0.5 KB, the same make_preference<POD> idiom as MeterBlob /
// AutosBlob. No unchanged-skip: a save only ever follows a fresh event, so the
// blob always differs (and events are rare — writes never ride a hot path).
static constexpr uint32_t EVENTS_BLOB_KEY = 0x45564E54;   // "EVNT" — preferences hash
static constexpr uint32_t EVENTS_BLOB_MAGIC = 0x45564E31; // "EVN1" — format/sanity tag
struct EventsBlob {
  uint32_t magic;
  uint8_t count;
  ControlEvent events[MAX_EVENTS];
};

void MajiControl::setup() {
  state_.init(routes_, (int) valves_.size());
  state_.set_manual_pumps(manual_pumps_);
  // Boot to a known-closed valve state: time_based covers restore to UNKNOWN, so fire
  // the close coil once. commanded_valve_mask stays 0 to match (reconciler is silent until
  // a slot claims a valve).
  for (auto &v : valves_)
    if (v.cover != nullptr) v.cover->make_call().set_command_close().perform();
  state_.commanded_valve_mask = 0;

  // Billing meter: durable counter + run ledger. Restore from flash (and close any run
  // left open by a mid-run reboot), then seed the transition-diff baseline.
  meter_.init((int) flows_.size(), MAX_CONCURRENT_ROUTES);
  meter_load_();
  events_load_();  // the event log survives reboot ("what happened at 3am")
  for (int s = 0; s < MAX_CONCURRENT_ROUTES; s++) {
    prev_state_[s] = state_.slots[s].state;
    prev_stop_[s] = 0;
  }
}

void MajiControl::dump_config() {
  ESP_LOGCONFIG(TAG, "MajiControl: %d route(s), %d valve(s), %d pump(s), %d manual-pump(s)",
                (int) routes_.size(), (int) valves_.size(), (int) pumps_.size(), (int) manual_pumps_.size());
}

uint32_t MajiControl::resolve_ms_(number::Number *n, float floor_s, uint32_t default_ms) {
  float v = n != nullptr ? n->state : NAN;
  return (!std::isnan(v) && v >= floor_s) ? (uint32_t) (v * 1000.0f) : default_ms;
}

uint32_t MajiControl::route_travel_ms_(const Route &r) {
  uint32_t mx = 0;
  for (int i = 0; i < (int) valves_.size() && i < 16; i++) {
    if (!(r.valve_mask & (1 << i))) continue;
    uint32_t t = resolve_ms_(valves_[i].travel_s, 1.0f, def_valve_travel_ms_);
    if (t > mx) mx = t;
  }
  return mx;
}

uint16_t MajiControl::valve_claim_bits_() {
  if (claims_ == nullptr) return 0;
  uint16_t b = 0;
  int n = claims_->valve_count();
  for (int i = 0; i < n && i < 16; i++)
    if (claims_->has_live_claim(claims_->valve_id_for_index(i))) b |= (1 << i);
  return b;
}

uint32_t MajiControl::manual_claim_bits_() {
  if (claims_ == nullptr) return 0;
  uint32_t b = 0;
  for (int k = 0; k < (int) manual_pumps_.size() && k < 32; k++)
    if (claims_->has_live_claim(manual_pumps_[k].node_id)) b |= (1u << k);
  return b;
}

Inputs MajiControl::snapshot_(uint32_t now) {
  Inputs in;
  in.now_ms = now;
  in.safety_override = safety_override_ != nullptr && safety_override_->state;
  in.flow_watchdog_ms = resolve_ms_(flow_watchdog_, 5.0f, def_watchdog_ms_);
  in.flow_confirm_ms = resolve_ms_(flow_confirm_, 3.0f, def_confirm_ms_);
  float th = flow_threshold_ != nullptr ? flow_threshold_->state : NAN;
  in.flow_threshold_l_min = (!std::isnan(th) && th >= 0.1f) ? th : def_threshold_;

  for (auto *t : tanks_) in.tank_levels.push_back(t != nullptr ? t->state : -1.0f);
  for (auto &f : flows_) {
    in.flow_rates.push_back(f.rate != nullptr ? f.rate->state : -1.0f);
    in.flow_totals.push_back(f.total != nullptr ? f.total->state : -1.0f);
  }

  in.route_tunables.resize(routes_.size());
  for (size_t r = 0; r < routes_.size(); r++) {
    RouteTunables &rt = in.route_tunables[r];
    const RouteHandles &h = route_handles_[r];
    const Route &route = routes_[r];
    rt.travel_ms = route_travel_ms_(route);
    {
      float v = h.max_runtime != nullptr ? h.max_runtime->state : NAN;
      rt.max_runtime_s = (!std::isnan(v) && v >= 1.0f) ? (uint16_t) (v * 60.0f) : route.max_runtime_s;
    }
    {
      float v = h.source_min != nullptr ? h.source_min->state : NAN;
      rt.source_min_pct = (!std::isnan(v) && v >= 0.0f && v <= 100.0f) ? (uint8_t) v : route.source_min_pct;
    }
    {
      float v = h.dest_max != nullptr ? h.dest_max->state : NAN;
      rt.dest_max_pct = (!std::isnan(v) && v >= 0.0f && v <= 100.0f) ? (uint8_t) v : route.dest_max_pct;
    }
    {
      float v = h.target_duration != nullptr ? h.target_duration->state : NAN;
      rt.target_duration_s = (!std::isnan(v) && v >= 0.0f) ? (uint16_t) v : 0;
    }
    {
      float v = h.target_volume != nullptr ? h.target_volume->state : NAN;
      rt.target_volume_l = (!std::isnan(v) && v >= 0.0f) ? (uint32_t) v : 0;
    }
    if (route.flow_sensor == 0xFF) {
      rt.flow_stall_enable = 0;
    } else {
      float v = h.flow_stall != nullptr ? h.flow_stall->state : NAN;
      rt.flow_stall_enable = std::isnan(v) ? 1 : (v >= 0.5f ? 1 : 0);
    }
  }

  in.claim_valve_bits = valve_claim_bits_();
  in.manual_claim_bits = manual_claim_bits_();
  return in;
}

void MajiControl::apply_pumps_(const Inputs &in) {
  // Pump relays (pumps_ in pump-index order, == ROUTES pump_idx). A pump runs on a
  // route ref-count, or on a guarded manual/peer claim. The guarding manual pump is
  // the one whose relay_idx points at this pump (local pumps only; -1 = none).
  for (int i = 0; i < (int) pumps_.size(); i++) {
    if (pumps_[i] == nullptr) continue;
    int k = -1;
    for (int j = 0; j < (int) manual_pumps_.size(); j++)
      if (manual_pumps_[j].relay_idx == i) { k = j; break; }
    bool claim = k >= 0 && claims_ != nullptr && claims_->has_live_claim(manual_pumps_[k].node_id);
    bool need = pump_ref_count(state_, i) > 0 || (claim && manual_claim_ok(state_, in, k));
    if (need && !pumps_[i]->state) pumps_[i]->turn_on();
    else if (!need && pumps_[i]->state) pumps_[i]->turn_off();
  }
}

void MajiControl::apply_valves_(uint32_t now, uint16_t claim_valve_bits) {
  uint16_t desired = desired_valve_mask(state_, now, claim_valve_bits);
  uint16_t diff = desired ^ state_.commanded_valve_mask;
  if (!diff) return;
  for (int i = 0; i < (int) valves_.size() && i < 16; i++) {
    if (!(diff & (1 << i)) || valves_[i].cover == nullptr) continue;
    if (desired & (1 << i)) valves_[i].cover->make_call().set_command_open().perform();
    else valves_[i].cover->make_call().set_command_close().perform();
  }
  state_.commanded_valve_mask = desired;
}

void MajiControl::tick_1s(uint32_t wall_epoch) {
  uint32_t now = millis();
  Inputs in = snapshot_(now);
  TickResult tr = maji_ctl::tick_1s(state_, in);

  // Meter: stamp the lineage epoch (once, when time first trusts), feed the durable
  // counter from each flow sensor's cumulative total (already litres, units_per_litre=1),
  // then reconcile run open/close from the slot transitions this tick.
  maji_meter::stamp_epoch(meter_, wall_epoch);
  if (wall_epoch) meter_.last_wall = wall_epoch;  // for a boot-interrupted run's duration
  if (wall_epoch) last_epoch_ = wall_epoch;       // event-log ts stamps (0 = untrusted)
  for (int i = 0; i < (int) flows_.size(); i++) {
    float t = flows_[i].total != nullptr ? flows_[i].total->state : NAN;
    if (!std::isnan(t) && t >= 0.0f) maji_meter::on_reading(meter_, i, (uint32_t) t, 1);
  }
  meter_sync_(wall_epoch, now);
  // Cache each slot's live progress facts for the snapshot (run_live needs Inputs).
  for (int s = 0; s < MAX_CONCURRENT_ROUTES; s++) live_[s] = maji_ctl::run_live(state_, in, s);
  // Mark the durable state dirty every ~30 s so the counter survives an unclean power
  // loss; ESPHome batches the actual flash write (its preferences flush interval, ~60 s
  // default), so the real worst-case loss is one flush window. Run close/ack save eagerly.
  if (++meter_tick_count_ % 30 == 0) meter_persist_();

  // Pump management AFTER tick_1s (a slot that became RUNNING this tick must count).
  manual_pump_guard_tick(state_, in);
  apply_pumps_(in);

  // The generated lambda copies system_state()/active_slot()/stop_reason() into the globals.
  if (tr.stop_reason_on_idle >= 0) last_stop_reason_ = tr.stop_reason_on_idle;

  apply_valves_(now, in.claim_valve_bits);
}

void MajiControl::tick_2s(uint32_t wall_epoch) {
  if (safety_override_ != nullptr && safety_override_->state) return;  // matches old early return
  uint32_t now = millis();
  Inputs in = snapshot_(now);
  WatchdogResult wr = maji_ctl::tick_2s(state_, in);
  if (wall_epoch) last_epoch_ = wall_epoch;
  // Event log: a slot that latched FAULT this tick. Faults originate inside the kernel
  // (tick_2s), so there is no command choke point to hook — diff against the pre-tick
  // baseline (prev_state_, still untouched until meter_sync_ below). The event carries
  // the faulted run's attribution (route_origin/route_actor) + the fault token.
  for (int s = 0; s < MAX_CONCURRENT_ROUTES; s++) {
    int rid = state_.slots[s].route_id;
    if (rid >= 0 && rid < (int) state_.routes.size() &&
        is_fault_transition(prev_state_[s], state_.slots[s].state))
      log_event_(rid, EV_FAULT, state_.route_origin[rid], state_.route_actor[rid],
                 fault_tok(state_.slots[s].fault_code));
  }
  meter_sync_(wall_epoch, now);  // catch RUNNING->FAULT closes set here (1s tick catches ->IDLE)
  for (int i = 0; i < (int) valves_.size() && i < 16; i++)
    if ((wr.fault_resync_valves & (1 << i)) && valves_[i].cover != nullptr)
      valves_[i].cover->make_call().set_command_stop().perform();
}

// Reconcile the meter against the kernel's slot transitions since the last sync. Opens a
// run on PREPARING->RUNNING and closes one on active->IDLE (clean) or ->FAULT. prev_stop_
// carries the STOPPING reason across the tick that wipes it (init_slot on ->IDLE); a fault
// reason is read live (->FAULT does not wipe). A close with no open run is a kernel no-op.
void MajiControl::meter_sync_(uint32_t wall_epoch, uint32_t now) {
  for (int s = 0; s < MAX_CONCURRENT_ROUTES; s++) {
    int cur = state_.slots[s].state;
    int prev = prev_state_[s];

    if (prev == ST_PREPARING && cur == ST_RUNNING) {
      int rid = state_.slots[s].route_id;
      if (rid >= 0 && rid < (int) state_.routes.size()) {
        int fs = (state_.routes[rid].flow_sensor != 0xFF) ? (int) state_.routes[rid].flow_sensor : -1;
        maji_meter::open_run(meter_, s, rid, fs, origin_tok(state_.route_origin[rid]),
                             state_.route_actor[rid], wall_epoch, state_.slots[s].run_start_time);
      }
    }
    bool was_active = (prev >= ST_PREPARING && prev <= ST_STOPPING);
    if (was_active && cur == ST_IDLE) {
      maji_meter::close_run(meter_, s, stop_tok(prev_stop_[s]), "", wall_epoch, now);
      meter_persist_();
    } else if (was_active && cur == ST_FAULT) {
      maji_meter::close_run(meter_, s, stop_tok(state_.slots[s].stop_reason),
                            fault_tok(state_.slots[s].fault_code), wall_epoch, now);
      meter_persist_();
    }

    prev_state_[s] = cur;
    prev_stop_[s] = state_.slots[s].stop_reason;  // pre-wipe reason for the next ->IDLE
  }
}

int MajiControl::start_route(int route_id, const std::string &command_id, const StopSpec &spec,
                             uint8_t origin, const std::string &actor) {
  Inputs in = snapshot_(millis());
  int rc = try_route_start(state_, in, route_id, command_id, spec, origin, actor);
  // Event log: only a real start (rc 0) — a queue/refuse changes nothing the feed shows,
  // and an idempotent duplicate (RC_DUPLICATE) must not double-log the original command.
  if (rc == 0) log_event_(route_id, EV_START, origin, actor, "");
  return rc == RC_DUPLICATE ? 0 : rc;  // a duplicate reports the same idempotent success
}

int MajiControl::stop_route(int route_id, const std::string &command_id, uint8_t origin,
                            const std::string &actor) {
  int rc = try_route_stop(state_, route_id, command_id, origin, actor, millis());
  if (rc == 0) log_event_(route_id, EV_STOP, origin, actor, stop_tok(STOP_MANUAL));
  return rc == RC_DUPLICATE ? 0 : rc;  // a duplicate reports the same idempotent success
}

void MajiControl::stop_all(uint8_t origin, const std::string &actor) {
  uint32_t now = millis();
  bool any = false;
  for (int s = 0; s < MAX_CONCURRENT_ROUTES; s++)
    if (state_.slots[s].state >= ST_PREPARING && state_.slots[s].state <= ST_RUNNING) {
      state_.slots[s].stop_reason = STOP_MANUAL;
      state_.slots[s].state = ST_STOPPING;
      state_.slots[s].stop_time = now;
      any = true;
    }
  state_.queue_head = 0;
  state_.queue_count = 0;
  // Attribution rides the parameters: the panel (btn_stop_all) passes "panel", the
  // command dispatch passes the envelope actor. Idle stop-all is a no-op, logs nothing.
  if (any) log_event_(-1, EV_STOP_ALL, origin, actor, stop_tok(STOP_MANUAL));
}

void MajiControl::reset_faults() {
  for (int s = 0; s < MAX_CONCURRENT_ROUTES; s++)
    if (state_.slots[s].state == ST_FAULT) init_slot(state_, s);
  manual_clear_all_latches(state_);
}

void MajiControl::fault_reset(int route_id) {
  int s = find_slot_by_route(state_, route_id);
  if (s >= 0 && state_.slots[s].state == ST_FAULT) init_slot(state_, s);
}

void MajiControl::clear_queue() {
  state_.queue_head = 0;
  state_.queue_count = 0;
}

float MajiControl::tank_level(int idx) {
  return (idx >= 0 && idx < (int) tanks_.size() && tanks_[idx] != nullptr) ? tanks_[idx]->state : -1.0f;
}

int MajiControl::manual_slot(const std::string &node_id) { return manual_pump_slot(state_, node_id); }

int MajiControl::manual_precheck(int k) {
  Inputs in = snapshot_(millis());
  return manual_pump_precheck(state_, in, k);
}

void MajiControl::manual_clear_latch(int k) { maji_ctl::manual_clear_latch(state_, k); }

bool MajiControl::is_duplicate(const std::string &command_id) {
  return is_duplicate_command(state_, command_id, millis());
}

void MajiControl::record_outcome(const std::string &command_id, const std::string &result,
                                 const std::string &reason) {
  maji_ctl::record_outcome(state_, command_id, result, reason);
}

void MajiControl::log_event_(int route, uint8_t action, uint8_t origin, const std::string &actor,
                             const char *reason) {
  record_event(state_, last_epoch_, millis() / 1000, route, action, origin, actor.c_str(), reason);
  events_persist_();
}

void MajiControl::events_load_() {
  events_pref_ = global_preferences->make_preference<EventsBlob>(EVENTS_BLOB_KEY);
  EventsBlob b{};  // ~0.5 KB: small enough for the setup-task stack
  if (!events_pref_.load(&b) || b.magic != EVENTS_BLOB_MAGIC) return;  // fresh device / no record
  events_unpack(state_, b.events, b.count);
}

void MajiControl::events_persist_() {
  EventsBlob b{};
  b.magic = EVENTS_BLOB_MAGIC;
  b.count = events_pack(state_, b.events, MAX_EVENTS);
  events_pref_.save(&b);
}

void MajiControl::meter_load_() {
  meter_pref_ = global_preferences->make_preference<MeterBlob>(METER_BLOB_KEY);
  auto bp = std::unique_ptr<MeterBlob>(new MeterBlob());  // ~2 KB: heap, not the loop-task stack
  MeterBlob &b = *bp;
  if (!meter_pref_.load(&b) || b.magic != METER_BLOB_MAGIC) return;  // fresh device / no record

  meter_.run_epoch = b.run_epoch;
  meter_.run_seq = b.run_seq;
  meter_.acked_epoch = b.acked_epoch;
  meter_.acked_seq = b.acked_seq;
  meter_.dropped = b.dropped;
  meter_.last_wall = b.last_wall;
  for (int i = 0; i < b.num_counters && i < (int) meter_.counters.size(); i++) {
    meter_.counters[i].litres = b.counters[i].litres;
    meter_.counters[i].remainder = b.counters[i].remainder;
    meter_.counters[i].last_raw = b.counters[i].last_raw;
    meter_.counters[i].seeded = b.counters[i].seeded != 0;
  }
  for (int i = 0; i < b.num_open && i < (int) meter_.open.size(); i++) {
    auto &o = meter_.open[i];
    o.active = b.open[i].active != 0;
    o.epoch = b.open[i].epoch;
    o.seq = b.open[i].seq;
    o.route = b.open[i].route;
    o.flow_sensor = b.open[i].flow_sensor;
    o.origin = b.open[i].origin;
    o.actor = b.open[i].actor;
    o.start_epoch = b.open[i].start_epoch;
    o.run_start_ms = b.open[i].run_start_ms;
    o.start_litres = b.open[i].start_litres;
  }
  meter_.outbox.clear();
  for (int i = 0; i < b.outbox_count && i < maji_meter::OUTBOX_CAP; i++) {
    maji_meter::RunRecord r;
    r.epoch = b.outbox[i].epoch;
    r.seq = b.outbox[i].seq;
    r.route = b.outbox[i].route;
    r.origin = b.outbox[i].origin;
    r.actor = b.outbox[i].actor;
    r.start_epoch = b.outbox[i].start_epoch;
    r.end_epoch = b.outbox[i].end_epoch;
    r.duration_s = b.outbox[i].duration_s;
    r.stop_reason = b.outbox[i].stop_reason;
    r.fault = b.outbox[i].fault;
    r.start_litres = b.outbox[i].start_litres;
    r.end_litres = b.outbox[i].end_litres;
    r.metered = b.outbox[i].metered != 0;
    meter_.outbox.push_back(r);
  }
  // A run still OPEN at boot means the controller died mid-run. Close it as interrupted:
  // delivered = restored counter - start (the durable counter survived), so its partial
  // delivery is still billed. now_ms=0 forces close_run's wall-clock duration fallback
  // (last_wall - start_epoch), the best duration estimate across the reboot.
  for (int s = 0; s < (int) meter_.open.size(); s++)
    if (meter_.open[s].active)
      maji_meter::close_run(meter_, s, "INTERRUPTED", "", meter_.last_wall, 0);
}

void MajiControl::meter_persist_() {
  auto bp = std::unique_ptr<MeterBlob>(new MeterBlob());  // ~2 KB: heap, not the loop-task stack
  MeterBlob &b = *bp;
  b.magic = METER_BLOB_MAGIC;
  b.run_epoch = meter_.run_epoch;
  b.run_seq = meter_.run_seq;
  b.acked_epoch = meter_.acked_epoch;
  b.acked_seq = meter_.acked_seq;
  b.dropped = meter_.dropped;
  b.last_wall = meter_.last_wall;

  b.num_counters = (uint8_t) std::min((int) meter_.counters.size(), BLOB_MAX_FLOW);
  for (int i = 0; i < b.num_counters; i++) {
    b.counters[i].litres = meter_.counters[i].litres;
    b.counters[i].remainder = meter_.counters[i].remainder;
    b.counters[i].last_raw = meter_.counters[i].last_raw;
    b.counters[i].seeded = meter_.counters[i].seeded ? 1 : 0;
  }
  b.num_open = (uint8_t) std::min((int) meter_.open.size(), BLOB_MAX_SLOT);
  for (int i = 0; i < b.num_open; i++) {
    const auto &o = meter_.open[i];
    b.open[i].active = o.active ? 1 : 0;
    b.open[i].epoch = o.epoch;
    b.open[i].seq = o.seq;
    b.open[i].route = o.route;
    b.open[i].flow_sensor = o.flow_sensor;
    cpstr(b.open[i].origin, sizeof(b.open[i].origin), o.origin);
    cpstr(b.open[i].actor, sizeof(b.open[i].actor), o.actor);
    b.open[i].start_epoch = o.start_epoch;
    b.open[i].run_start_ms = o.run_start_ms;
    b.open[i].start_litres = o.start_litres;
  }
  int oc = std::min((int) meter_.outbox.size(), (int) maji_meter::OUTBOX_CAP);
  b.outbox_count = (uint8_t) oc;
  for (int i = 0; i < oc; i++) {
    const auto &r = meter_.outbox[i];
    b.outbox[i].epoch = r.epoch;
    b.outbox[i].seq = r.seq;
    b.outbox[i].route = r.route;
    cpstr(b.outbox[i].origin, sizeof(b.outbox[i].origin), r.origin);
    cpstr(b.outbox[i].actor, sizeof(b.outbox[i].actor), r.actor);
    b.outbox[i].start_epoch = r.start_epoch;
    b.outbox[i].end_epoch = r.end_epoch;
    b.outbox[i].duration_s = r.duration_s;
    cpstr(b.outbox[i].stop_reason, sizeof(b.outbox[i].stop_reason), r.stop_reason);
    cpstr(b.outbox[i].fault, sizeof(b.outbox[i].fault), r.fault);
    b.outbox[i].start_litres = r.start_litres;
    b.outbox[i].end_litres = r.end_litres;
    b.outbox[i].metered = r.metered ? 1 : 0;
  }
  meter_pref_.save(&b);
}

}  // namespace maji_control
}  // namespace esphome
