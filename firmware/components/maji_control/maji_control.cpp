#include "maji_control.h"
#include "esphome/core/hal.h"
#include "esphome/core/log.h"
#include <cmath>

namespace esphome {
namespace maji_control {

static const char *const TAG = "maji_control";

using namespace maji_ctl;

void MajiControl::setup() {
  state_.init(routes_, (int) valves_.size());
  state_.set_manual_pumps(manual_pumps_);
  // Boot to a known-closed valve state: time_based covers restore to UNKNOWN, so fire
  // the close coil once. commanded_valve_mask stays 0 to match (reconciler is silent until
  // a slot claims a valve).
  for (auto &v : valves_)
    if (v.cover != nullptr) v.cover->make_call().set_command_close().perform();
  state_.commanded_valve_mask = 0;
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

void MajiControl::tick_1s() {
  uint32_t now = millis();
  Inputs in = snapshot_(now);
  TickResult tr = maji_ctl::tick_1s(state_, in);

  // Pump management AFTER tick_1s (a slot that became RUNNING this tick must count).
  manual_pump_guard_tick(state_, in);
  apply_pumps_(in);

  // The generated lambda copies system_state()/active_slot()/stop_reason() into the globals.
  if (tr.stop_reason_on_idle >= 0) last_stop_reason_ = tr.stop_reason_on_idle;

  apply_valves_(now, in.claim_valve_bits);
}

void MajiControl::tick_2s() {
  if (safety_override_ != nullptr && safety_override_->state) return;  // matches old early return
  uint32_t now = millis();
  Inputs in = snapshot_(now);
  WatchdogResult wr = maji_ctl::tick_2s(state_, in);
  for (int i = 0; i < (int) valves_.size() && i < 16; i++)
    if ((wr.fault_resync_valves & (1 << i)) && valves_[i].cover != nullptr)
      valves_[i].cover->make_call().set_command_stop().perform();
}

int MajiControl::start_route(int route_id, const std::string &command_id, const StopSpec &spec,
                             uint8_t origin, const std::string &actor) {
  Inputs in = snapshot_(millis());
  return try_route_start(state_, in, route_id, command_id, spec, origin, actor);
}

int MajiControl::stop_route(int route_id, const std::string &command_id, uint8_t origin,
                            const std::string &actor) {
  return try_route_stop(state_, route_id, command_id, origin, actor, millis());
}

void MajiControl::stop_all() {
  uint32_t now = millis();
  for (int s = 0; s < MAX_CONCURRENT_ROUTES; s++)
    if (state_.slots[s].state >= ST_PREPARING && state_.slots[s].state <= ST_RUNNING) {
      state_.slots[s].stop_reason = STOP_MANUAL;
      state_.slots[s].state = ST_STOPPING;
      state_.slots[s].stop_time = now;
    }
  state_.queue_head = 0;
  state_.queue_count = 0;
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

}  // namespace maji_control
}  // namespace esphome
