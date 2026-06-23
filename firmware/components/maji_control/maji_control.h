#pragma once
// Imperative shell for the route control kernel. Holds ESPHome entity handles (bound
// via use_id, idx-aligned with the kernel's data tables), snapshots them into an
// Inputs each tick, runs the pure kernel (control_core), and applies the resulting
// Decisions back to the hardware. All decision logic lives in core.{h,cpp}; this file
// is only I/O — read handles -> core -> actuate. See the SHELL CONTRACT in core.h.
#include "core.h"
#include "meter.h"
#include "esphome/core/component.h"
#include "esphome/core/preferences.h"
#include "esphome/components/sensor/sensor.h"
#include "esphome/components/cover/cover.h"
#include "esphome/components/switch/switch.h"
#include "esphome/components/number/number.h"
#include "../maji_claims/claims.h"
#include <string>
#include <vector>

namespace esphome {
namespace maji_control {

// Per-route operator tunables (the get_route_* number entities in the old routes.h).
// Any may be null (route without that knob); the snapshot falls back to the route's
// baked value, mirroring the old getters' NaN/absent handling.
struct RouteHandles {
  number::Number *max_runtime{nullptr};      // minutes  (>=1 else baked seconds)
  number::Number *target_duration{nullptr};  // seconds  (>=0 else 0)
  number::Number *target_volume{nullptr};    // litres   (>=0 else 0)
  number::Number *source_min{nullptr};       // percent  (0..100 else baked)
  number::Number *dest_max{nullptr};         // percent  (0..100 else baked)
  number::Number *flow_stall{nullptr};       // bool-ish (NaN -> enabled)
};

struct ValveHandles {
  cover::Cover *cover{nullptr};
  number::Number *travel_s{nullptr};  // seconds (>=1 else DEFAULT_VALVE_TRAVEL_MS)
};

struct FlowHandles {
  sensor::Sensor *rate{nullptr};
  sensor::Sensor *total{nullptr};  // may be null (remote sensor: no total)
};

class MajiControl : public Component {
 public:
  // --- config (called from to_code, idx order == kernel table order) ---
  void add_route(const maji_ctl::Route &r, const RouteHandles &h) {
    routes_.push_back(r);
    route_handles_.push_back(h);
  }
  void add_manual_pump(const maji_ctl::ManualPump &mp) { manual_pumps_.push_back(mp); }
  void add_tank(sensor::Sensor *level) { tanks_.push_back(level); }      // null = unmonitored
  void add_flow(const FlowHandles &f) { flows_.push_back(f); }
  void add_valve(const ValveHandles &v) { valves_.push_back(v); }
  void add_pump(switch_::Switch *relay) { pumps_.push_back(relay); }

  void set_claims(maji_claims::MajiClaims *c) { claims_ = c; }
  void set_safety_override(switch_::Switch *s) { safety_override_ = s; }
  void set_flow_watchdog(number::Number *n) { flow_watchdog_ = n; }
  void set_flow_confirm(number::Number *n) { flow_confirm_ = n; }
  void set_flow_threshold(number::Number *n) { flow_threshold_ = n; }
  // Manifest-baked fallbacks used when a tunable is unset/below its floor (the old DEFAULT_*_MS).
  void set_defaults(uint32_t watchdog_ms, uint32_t confirm_ms, float threshold, uint32_t valve_travel_ms) {
    def_watchdog_ms_ = watchdog_ms;
    def_confirm_ms_ = confirm_ms;
    def_threshold_ = threshold;
    def_valve_travel_ms_ = valve_travel_ms;
  }

  // Status the generated tick lambda copies into the system_state/stop_reason/active_slot
  // globals (kept as globals so the OLED display reads them unchanged).
  int system_state() { return maji_ctl::derived_system_state(state_); }
  int stop_reason() const { return last_stop_reason_; }
  int active_slot() const {
    for (int s = 0; s < maji_ctl::MAX_CONCURRENT_ROUTES; s++)
      if (state_.slots[s].state >= maji_ctl::ST_PREPARING && state_.slots[s].state <= maji_ctl::ST_STOPPING)
        return s;
    return -1;
  }

  void setup() override;
  float get_setup_priority() const override { return setup_priority::LATE; }
  void dump_config() override;

  // --- the two interval ticks (called from generated 1s/2s intervals) ---
  // wall_epoch = trusted unix seconds (0 when time is not yet trusted); the generated
  // lambda passes it so the meter can stamp run timestamps. The control logic ignores it.
  void tick_1s(uint32_t wall_epoch = 0);
  void tick_2s(uint32_t wall_epoch = 0);

  // --- command surface (mqtt router + buttons + automations call these) ---
  // Return codes mirror the old try_route_* / NODE_SET vocab so outcomes are unchanged.
  int start_route(int route_id, const std::string &command_id, const maji_ctl::StopSpec &spec,
                  uint8_t origin, const std::string &actor);
  int stop_route(int route_id, const std::string &command_id, uint8_t origin, const std::string &actor);
  void stop_all();           // btn_stop_all
  void reset_faults();       // btn_reset_faults (all faults)
  void fault_reset(int route_id);  // clear one route's fault (mqtt fault_reset)
  void clear_queue();        // btn_clear_queue

  // Current level (%) of tank `idx`, or -1.0f if unbound/unmonitored (the old
  // get_tank_level). Read by the automation engine's level triggers.
  float tank_level(int idx);
  // Manual-pump primitives the mqtt node_set router calls (claims.extend/drop stays on id(claims)).
  int manual_slot(const std::string &node_id);
  int manual_precheck(int k);
  void manual_clear_latch(int k);
  bool is_duplicate(const std::string &command_id);  // mqtt stale/dup gate
  void record_outcome(const std::string &command_id, const std::string &result, const std::string &reason);

  maji_ctl::ControlState &state() { return state_; }  // snapshot builder reads this

  // --- Billing meter (delegates to the pure maji_meter kernel) -----------------
  // Called by codegen lambdas: the runs_ack subscriber and the snapshot publisher.
  // Run open/close + counter feed happen inside tick_1s/tick_2s (meter_sync_).
  void meter_on_ack(uint32_t epoch, uint32_t seq) {
    maji_meter::on_ack(meter_, epoch, seq);
    meter_persist_();
  }
  int meter_runs_json(char *buf, int cap) { return maji_meter::serialize_runs(meter_, buf, cap); }

  // Live run facts for the snapshot's per-route progress (card-as-progress-bar). Cached
  // each tick (run_live needs Inputs, which only the tick builds); the snapshot reads it.
  const maji_ctl::RunLive &route_live(int slot) const {
    static const maji_ctl::RunLive kEmpty{-1, 0, 0, 0, -1};
    return (slot >= 0 && slot < maji_ctl::MAX_CONCURRENT_ROUTES) ? live_[slot] : kEmpty;
  }

 protected:
  // Fill an Inputs from the bound handles (the only place id()/state is read for the kernel).
  maji_ctl::Inputs snapshot_(uint32_t now);
  // Remote-claim bitmaps the kernel needs: which valves / manual pumps have a live claim.
  uint16_t valve_claim_bits_();
  uint32_t manual_claim_bits_();
  // Resolve a tunable number with a floor, else a default (mirrors the old ms conversions).
  uint32_t resolve_ms_(number::Number *n, float floor_s, uint32_t default_ms);
  // Max valve-travel (ms) across a route's valves (the old get_route_travel_ms).
  uint32_t route_travel_ms_(const maji_ctl::Route &r);
  // Apply kernel outputs to hardware.
  void apply_pumps_(const maji_ctl::Inputs &in);
  void apply_valves_(uint32_t now, uint16_t claim_valve_bits);

  // Reconcile run open/close from the kernel's slot transitions and feed the durable
  // counter; called at the end of each tick (1s catches ->IDLE, 2s catches ->FAULT).
  void meter_sync_(uint32_t wall_epoch, uint32_t now);
  void meter_load_();     // restore MeterState from NVS in setup() + close any interrupted run
  void meter_persist_();  // serialize MeterState to the fixed NVS blob (flash write is batched)

  maji_meter::MeterState meter_;
  ESPPreferenceObject meter_pref_;
  // Pre-tick slot snapshot for the transition diff (prev_stop_ holds the reason before
  // init_slot wipes it on ->IDLE).
  int prev_state_[maji_ctl::MAX_CONCURRENT_ROUTES];
  int prev_stop_[maji_ctl::MAX_CONCURRENT_ROUTES];
  uint32_t meter_tick_count_{0};
  maji_ctl::RunLive live_[maji_ctl::MAX_CONCURRENT_ROUTES];  // per-slot live progress, refreshed each tick

  maji_ctl::ControlState state_;
  std::vector<maji_ctl::Route> routes_;
  std::vector<RouteHandles> route_handles_;
  std::vector<maji_ctl::ManualPump> manual_pumps_;
  std::vector<sensor::Sensor *> tanks_;
  std::vector<FlowHandles> flows_;
  std::vector<ValveHandles> valves_;
  std::vector<switch_::Switch *> pumps_;

  maji_claims::MajiClaims *claims_{nullptr};
  switch_::Switch *safety_override_{nullptr};
  number::Number *flow_watchdog_{nullptr};
  number::Number *flow_confirm_{nullptr};
  number::Number *flow_threshold_{nullptr};
  uint32_t def_watchdog_ms_{20000};
  uint32_t def_confirm_ms_{3000};
  float def_threshold_{1.0f};
  uint32_t def_valve_travel_ms_{15000};
  int last_stop_reason_{0};  // last slot's stop reason on reaching IDLE (-> id(stop_reason))
};

}  // namespace maji_control
}  // namespace esphome
