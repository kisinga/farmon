#include "core.h"
#include <cmath>

namespace maji_ctl {

// NaN if idx is out of range (mirrors the getters' "unavailable" sentinel).
static float at(const std::vector<float> &v, int idx) {
  return (idx >= 0 && idx < (int) v.size()) ? v[idx] : NAN;
}
static const RouteTunables &tun(const Inputs &in, int rid) {
  static const RouteTunables kDefault{};
  return (rid >= 0 && rid < (int) in.route_tunables.size()) ? in.route_tunables[rid] : kDefault;
}

void init_slot(ControlState &cs, int s) {
  cs.slots[s] = RouteSlot{};
  cs.slots[s].route_id = -1;
}

void ControlState::init(std::vector<Route> table, int valves) {
  routes = std::move(table);
  num_valves = valves;
  route_origin.assign(routes.size(), ORIGIN_SYSTEM);
  route_actor.assign(routes.size(), std::string());
  for (int i = 0; i < MAX_CONCURRENT_ROUTES; i++) init_slot(*this, i);
}

void ControlState::set_manual_pumps(std::vector<ManualPump> pumps) {
  manual_pumps = std::move(pumps);
  manual_latch.assign(manual_pumps.size(), 0);
  manual_run_since.assign(manual_pumps.size(), 0);
  manual_last_flow.assign(manual_pumps.size(), 0);
}

int find_free_slot(const ControlState &cs) {
  for (int i = 0; i < MAX_CONCURRENT_ROUTES; i++)
    if (cs.slots[i].state == ST_IDLE) return i;
  return -1;
}

int find_slot_by_route(const ControlState &cs, int rid) {
  for (int i = 0; i < MAX_CONCURRENT_ROUTES; i++)
    if (cs.slots[i].route_id == rid) return i;
  return -1;
}

// Conflict = a PREPARING/RUNNING slot whose route is in rid's conflict_mask
// (shared sensor + different destination, computed at codegen time).
bool has_conflict(const ControlState &cs, int rid) {
  for (int i = 0; i < MAX_CONCURRENT_ROUTES; i++)
    if ((cs.slots[i].state == ST_PREPARING || cs.slots[i].state == ST_RUNNING) && cs.slots[i].route_id >= 0)
      if (cs.routes[rid].conflict_mask & (1 << cs.slots[i].route_id)) return true;
  return false;
}

// Count of RUNNING slots whose route needs a specific pump.
int pump_ref_count(const ControlState &cs, uint8_t pump_idx) {
  int c = 0;
  for (int i = 0; i < MAX_CONCURRENT_ROUTES; i++)
    if (cs.slots[i].state == ST_RUNNING && cs.slots[i].route_id >= 0 &&
        cs.routes[cs.slots[i].route_id].pump_idx == pump_idx)
      c++;
  return c;
}

// Highest-priority state across all slots. FAULT(4) wins, else the max.
int derived_system_state(const ControlState &cs) {
  int h = 0;
  for (int i = 0; i < MAX_CONCURRENT_ROUTES; i++) {
    if (cs.slots[i].state == ST_FAULT) return ST_FAULT;
    if (cs.slots[i].state > h) h = cs.slots[i].state;
  }
  return h;
}

void bind_route_actor(ControlState &cs, int route_id, uint8_t origin, const std::string &actor) {
  if (route_id < 0 || route_id >= (int) cs.routes.size()) return;
  cs.route_origin[route_id] = origin;
  cs.route_actor[route_id] = actor.size() > 15 ? actor.substr(0, 15) : actor;  // mirror char[16]
}

// Valves slot s is claiming now: its route's valve_mask while PREPARING/RUNNING, and
// during the depressurize window after entering STOPPING/FAULT.
uint16_t valve_claim_mask(const ControlState &cs, int s, uint32_t now_ms) {
  if (cs.slots[s].route_id < 0) return 0;
  int st = cs.slots[s].state;
  if (st == ST_PREPARING || st == ST_RUNNING) return cs.routes[cs.slots[s].route_id].valve_mask;
  if (st == ST_STOPPING || st == ST_FAULT) {
    if ((now_ms - cs.slots[s].stop_time) < DEPRESSURIZE_MS) return cs.routes[cs.slots[s].route_id].valve_mask;
  }
  return 0;
}

// Union of slot claims plus remote claims (claim_valve_bits, precomputed by the shell).
uint16_t desired_valve_mask(const ControlState &cs, uint32_t now_ms, uint16_t claim_valve_bits) {
  uint16_t m = 0;
  for (int i = 0; i < MAX_CONCURRENT_ROUTES; i++) m |= valve_claim_mask(cs, i, now_ms);
  m |= claim_valve_bits;
  return m;
}

bool queue_push(ControlState &cs, int rid, const StopSpec &spec, uint8_t origin, const std::string &actor) {
  if (cs.queue_count >= MAX_QUEUE_SIZE) return false;
  QueueEntry &e = cs.queue[(cs.queue_head + cs.queue_count) % MAX_QUEUE_SIZE];
  e.route_id = rid;
  e.spec = spec;
  e.origin = origin;
  e.actor = actor.size() > 15 ? actor.substr(0, 15) : actor;
  cs.queue_count++;
  return true;
}

QueueEntry queue_pop(ControlState &cs) {
  if (cs.queue_count == 0) return QueueEntry{};
  QueueEntry v = cs.queue[cs.queue_head];
  cs.queue_head = (cs.queue_head + 1) % MAX_QUEUE_SIZE;
  cs.queue_count--;
  return v;
}

int queue_peek(const ControlState &cs, int i) {
  if (i >= cs.queue_count) return -1;
  return cs.queue[(cs.queue_head + i) % MAX_QUEUE_SIZE].route_id;
}

bool is_duplicate_command(ControlState &cs, const std::string &command_id, uint32_t now_ms) {
  if (command_id.empty()) return false;
  // prune expired
  for (auto it = cs.processed_commands.begin(); it != cs.processed_commands.end();) {
    if (now_ms - it->second > COMMAND_TTL_MS) it = cs.processed_commands.erase(it);
    else ++it;
  }
  if (cs.processed_commands.find(command_id) != cs.processed_commands.end()) return true;
  if ((int) cs.processed_commands.size() >= COMMAND_CAP) {
    auto oldest = cs.processed_commands.begin();
    for (auto jt = cs.processed_commands.begin(); jt != cs.processed_commands.end(); ++jt)
      if (jt->second < oldest->second) oldest = jt;
    cs.processed_commands.erase(oldest);
  }
  cs.processed_commands[command_id] = now_ms;
  return false;
}

void record_outcome(ControlState &cs, const std::string &command_id, const std::string &result,
                    const std::string &reason) {
  if (command_id.empty()) return;  // automations/local: no command_id to ack
  CmdOutcome &o = cs.outcomes[cs.outcome_head];
  o.command_id = command_id.size() > 19 ? command_id.substr(0, 19) : command_id;
  o.result = result.size() > 15 ? result.substr(0, 15) : result;
  o.reason = reason.size() > 15 ? reason.substr(0, 15) : reason;
  cs.outcome_head = (cs.outcome_head + 1) % MAX_OUTCOMES;
}

// --- Effective run-params (slot override else route's live tunable) ---

uint8_t effective_source_min_pct(const ControlState &cs, const Inputs &in, int s) {
  return (cs.slots[s].override_mask & OV_SOURCE_MIN) ? cs.slots[s].ov_source_min_pct
                                                     : tun(in, cs.slots[s].route_id).source_min_pct;
}
uint8_t effective_dest_max_pct(const ControlState &cs, const Inputs &in, int s) {
  return (cs.slots[s].override_mask & OV_DEST_MAX) ? cs.slots[s].ov_dest_max_pct
                                                   : tun(in, cs.slots[s].route_id).dest_max_pct;
}
uint16_t effective_max_runtime_s(const ControlState &cs, const Inputs &in, int s) {
  if (!(cs.slots[s].override_mask & OV_MAX_RT)) return tun(in, cs.slots[s].route_id).max_runtime_s;
  uint16_t mins = cs.slots[s].ov_max_runtime_min;  // clamp mirrors the tunable bounds [1,120] min
  if (mins < 1) mins = 1;
  if (mins > 120) mins = 120;
  return (uint16_t) (mins * 60);
}
uint16_t effective_target_duration_s(const ControlState &cs, const Inputs &in, int s) {
  return (cs.slots[s].override_mask & OV_DURATION) ? cs.slots[s].ov_target_duration_s
                                                   : tun(in, cs.slots[s].route_id).target_duration_s;
}
uint32_t effective_target_volume_l(const ControlState &cs, const Inputs &in, int s) {
  return (cs.slots[s].override_mask & OV_VOLUME) ? cs.slots[s].ov_target_volume_l
                                                 : tun(in, cs.slots[s].route_id).target_volume_l;
}

int check_precheck(const Inputs &in, uint8_t src_idx, uint8_t src_min, uint8_t dst_idx, uint8_t dst_max) {
  if (in.safety_override) return 0;
  if (src_idx != 0xFF && src_min > 0) {
    float src = at(in.tank_levels, src_idx);
    if (std::isnan(src) || src < (float) src_min) return 3;
  }
  if (dst_idx != 0xFF && dst_max > 0) {
    float dst = at(in.tank_levels, dst_idx);
    if (!std::isnan(dst) && dst > (float) dst_max) return 4;
  }
  return 0;
}

void activate_slot(ControlState &cs, int slot, int route_id, const StopSpec &spec, uint8_t origin,
                   const std::string &actor, uint32_t now_ms) {
  init_slot(cs, slot);
  cs.slots[slot].route_id = route_id;
  cs.slots[slot].state = ST_PREPARING;
  cs.slots[slot].start_time = now_ms;
  cs.slots[slot].override_mask = spec.override_mask;
  cs.slots[slot].ov_source_min_pct = spec.ov_source_min_pct;
  cs.slots[slot].ov_dest_max_pct = spec.ov_dest_max_pct;
  cs.slots[slot].ov_max_runtime_min = spec.ov_max_runtime_min;
  cs.slots[slot].ov_target_duration_s = spec.ov_target_duration_s;
  cs.slots[slot].ov_target_volume_l = spec.ov_target_volume_l;
  bind_route_actor(cs, route_id, origin, actor);  // valves open via the reconciler next tick
}

int try_route_start(ControlState &cs, const Inputs &in, int route_id, const std::string &command_id,
                    const StopSpec &spec, uint8_t origin, const std::string &actor) {
  if (route_id < 0 || route_id >= (int) cs.routes.size()) return 2;
  if (is_duplicate_command(cs, command_id, in.now_ms)) return 0;  // idempotent success
  if (find_slot_by_route(cs, route_id) != -1) return 2;           // already active

  if (has_conflict(cs, route_id) || find_free_slot(cs) == -1)
    return queue_push(cs, route_id, spec, origin, actor) ? 1 : 2;

  const Route &r = cs.routes[route_id];
  uint8_t eff_src_min = (spec.override_mask & OV_SOURCE_MIN) ? spec.ov_source_min_pct : tun(in, route_id).source_min_pct;
  uint8_t eff_dst_max = (spec.override_mask & OV_DEST_MAX) ? spec.ov_dest_max_pct : tun(in, route_id).dest_max_pct;
  int pc = check_precheck(in, r.source_tank, eff_src_min, r.dest_tank, eff_dst_max);
  if (pc != 0) return pc;

  activate_slot(cs, find_free_slot(cs), route_id, spec, origin, actor, in.now_ms);
  return 0;
}

int try_route_stop(ControlState &cs, int route_id, const std::string &command_id, uint8_t origin,
                   const std::string &actor, uint32_t now_ms) {
  if (is_duplicate_command(cs, command_id, now_ms)) return 0;  // idempotent success
  int s = find_slot_by_route(cs, route_id);
  if (s < 0) return 1;
  if (cs.slots[s].state == ST_IDLE || cs.slots[s].state == ST_STOPPING || cs.slots[s].state == ST_FAULT)
    return 2;
  cs.slots[s].stop_reason = STOP_MANUAL;
  cs.slots[s].state = ST_STOPPING;
  cs.slots[s].stop_time = now_ms;
  bind_route_actor(cs, route_id, origin, actor);
  return 0;
}

TickResult tick_1s(ControlState &cs, const Inputs &in) {
  TickResult res;
  uint32_t now = in.now_ms;
  for (int s = 0; s < MAX_CONCURRENT_ROUTES; s++) {
    int rid = cs.slots[s].route_id;
    if (rid < 0) continue;

    // PREPARING -> RUNNING (valve travel complete)
    if (cs.slots[s].state == ST_PREPARING) {
      if (now - cs.slots[s].start_time > tun(in, rid).travel_ms + 1000) {
        cs.slots[s].state = ST_RUNNING;
        res.transitioned = true;
        cs.slots[s].run_start_time = now;
        cs.slots[s].flow_active_since = 0;
        cs.slots[s].last_flow_time = now;
        cs.slots[s].flow_confirmed = false;
        cs.slots[s].volume_at_start =
            (cs.routes[rid].flow_sensor != 0xFF) ? at(in.flow_totals, cs.routes[rid].flow_sensor) : -1.0f;
      }
    }

    // STOPPING -> IDLE (depressurize + valve close travel complete)
    if (cs.slots[s].state == ST_STOPPING) {
      if (now - cs.slots[s].stop_time > DEPRESSURIZE_MS + tun(in, rid).travel_ms + 1000) {
        res.stop_reason_on_idle = cs.slots[s].stop_reason;
        init_slot(cs, s);
        res.transitioned = true;
      }
    }
    // FAULT stays until fault_reset.
  }

  // Queue drain.
  while (cs.queue_count > 0) {
    int next = queue_peek(cs, 0);
    if (next < 0 || next >= (int) cs.routes.size()) { queue_pop(cs); continue; }
    if (find_slot_by_route(cs, next) != -1) { queue_pop(cs); continue; }
    if (has_conflict(cs, next) || find_free_slot(cs) == -1) break;
    QueueEntry qe = queue_pop(cs);
    activate_slot(cs, find_free_slot(cs), qe.route_id, qe.spec, qe.origin, qe.actor, now);
    res.transitioned = true;
  }
  return res;
}

WatchdogResult tick_2s(ControlState &cs, const Inputs &in) {
  WatchdogResult res;
  if (in.safety_override) return res;
  uint32_t now = in.now_ms;

  for (int s = 0; s < MAX_CONCURRENT_ROUTES; s++) {
    if (cs.slots[s].state != ST_RUNNING) continue;
    int rid = cs.slots[s].route_id;
    if (rid < 0 || rid >= (int) cs.routes.size()) continue;
    const Route &r = cs.routes[rid];
    uint32_t runtime = now - cs.slots[s].run_start_time;

    // Flow sampling + dry-run / tank-full watchdog (monitored routes only).
    if (r.flow_sensor != 0xFF) {
      float flow = at(in.flow_rates, r.flow_sensor);
      if (!std::isnan(flow) && flow >= in.flow_threshold_l_min) {
        if (cs.slots[s].flow_active_since == 0) cs.slots[s].flow_active_since = now;
        cs.slots[s].last_flow_time = now;
        if (!cs.slots[s].flow_confirmed && now - cs.slots[s].flow_active_since >= in.flow_confirm_ms)
          cs.slots[s].flow_confirmed = true;
      } else {
        cs.slots[s].flow_active_since = 0;
      }
      if (cs.slots[s].fault_code == 0 && runtime > in.flow_watchdog_ms) {
        uint32_t age = now - cs.slots[s].last_flow_time;
        if (age > in.flow_watchdog_ms) {
          if (cs.slots[s].flow_confirmed) {
            if (tun(in, rid).flow_stall_enable) cs.slots[s].tank_full_detected = true;
          } else {
            cs.slots[s].fault_code = FAULT_NO_FLOW;  // dry-run protection (always on)
          }
        }
      }
    }

    // Runtime level checks (only when the route's level readings are pump-reliable).
    if (cs.slots[s].fault_code == 0 && r.runtime_level_ok) {
      uint8_t src_min = effective_source_min_pct(cs, in, s);
      uint8_t dst_max = effective_dest_max_pct(cs, in, s);
      if (src_min > 0 && r.source_tank != 0xFF) {
        float src = at(in.tank_levels, r.source_tank);
        if (!std::isnan(src) && src < (float) src_min) {
          cs.slots[s].stop_reason = STOP_SOURCE_LOW;
          cs.slots[s].state = ST_STOPPING;
          cs.slots[s].stop_time = now;
        }
      }
      if (cs.slots[s].state == ST_RUNNING && dst_max > 0 && r.dest_tank != 0xFF) {
        float dst = at(in.tank_levels, r.dest_tank);
        if (!std::isnan(dst) && dst >= (float) dst_max) {
          cs.slots[s].stop_reason = STOP_TANK_FULL;
          cs.slots[s].state = ST_STOPPING;
          cs.slots[s].stop_time = now;
        }
      }
    }

    // Intent stops (clean completion): volume, then duration.
    if (cs.slots[s].state == ST_RUNNING && cs.slots[s].fault_code == 0) {
      uint32_t eff_vol = effective_target_volume_l(cs, in, s);
      if (eff_vol > 0 && r.flow_sensor != 0xFF && cs.slots[s].volume_at_start >= 0.0f) {
        float total = at(in.flow_totals, r.flow_sensor);
        if (!std::isnan(total) && (total - cs.slots[s].volume_at_start) >= (float) eff_vol) {
          cs.slots[s].stop_reason = STOP_VOLUME_REACHED;
          cs.slots[s].state = ST_STOPPING;
          cs.slots[s].stop_time = now;
        }
      }
    }
    if (cs.slots[s].state == ST_RUNNING && cs.slots[s].fault_code == 0) {
      uint16_t eff_dur = effective_target_duration_s(cs, in, s);
      if (eff_dur > 0 && runtime >= ((uint32_t) eff_dur * 1000U)) {
        cs.slots[s].stop_reason = STOP_DURATION_REACHED;
        cs.slots[s].state = ST_STOPPING;
        cs.slots[s].stop_time = now;
      }
    }

    // Max runtime backstop. Hitting the time limit is a warning, not a fault: the
    // run stops cleanly (like SOURCE_LOW / duration) and returns to idle with no
    // operator reset. The dry-run/no-flow and control-lost paths stay faults.
    // Guarded by state==RUNNING so an earlier clean stop still wins.
    {
      uint16_t max_rt = effective_max_runtime_s(cs, in, s);
      if (cs.slots[s].state == ST_RUNNING && cs.slots[s].fault_code == 0 &&
          runtime > ((uint32_t) max_rt * 1000U)) {
        cs.slots[s].stop_reason = STOP_MAX_RUNTIME;
        cs.slots[s].state = ST_STOPPING;
        cs.slots[s].stop_time = now;
      }
    }

    // Act on fault: resync the route's valves, latch FAULT.
    if (cs.slots[s].fault_code != 0) {
      res.fault_resync_valves |= r.valve_mask;
      cs.slots[s].stop_reason = cs.slots[s].fault_code + FAULT_TO_STOP_OFFSET;
      cs.slots[s].state = ST_FAULT;
      cs.slots[s].stop_time = now;
    }

    // Tank full -> clean stop.
    if (cs.slots[s].tank_full_detected) {
      cs.slots[s].stop_reason = STOP_TANK_FULL;
      cs.slots[s].state = ST_STOPPING;
      cs.slots[s].stop_time = now;
      cs.slots[s].tank_full_detected = false;
    }
  }
  return res;
}

const char *json_esc(const char *s) {
  static char out[160];
  int o = 0;
  for (int i = 0; s && s[i] && o < (int) sizeof(out) - 2; i++) {
    char c = s[i];
    if (c == '"' || c == '\\') { out[o++] = '\\'; out[o++] = c; }
    else if (c >= 0 && c < 0x20) { /* drop control chars */ }
    else out[o++] = c;
  }
  out[o] = '\0';
  return out;
}

// --- Manual / claim-driven pump guard ---

int manual_pump_slot(const ControlState &cs, const std::string &node_id) {
  for (int k = 0; k < (int) cs.manual_pumps.size(); k++)
    if (cs.manual_pumps[k].node_id == node_id) return k;
  return -1;
}

bool manual_claim_ok(const ControlState &cs, const Inputs &in, int k) {
  if (k < 0 || k >= (int) cs.manual_pumps.size()) return true;
  return in.safety_override || cs.manual_latch[k] == 0;
}

void manual_clear_latch(ControlState &cs, int k) {
  if (k >= 0 && k < (int) cs.manual_pumps.size()) {
    cs.manual_latch[k] = 0;
    cs.manual_run_since[k] = 0;
  }
}

void manual_clear_all_latches(ControlState &cs) {
  for (int k = 0; k < (int) cs.manual_pumps.size(); k++) manual_clear_latch(cs, k);
}

int manual_pump_precheck(const ControlState &cs, const Inputs &in, int k) {
  if (k < 0 || k >= (int) cs.manual_pumps.size()) return 0;
  if (in.safety_override) return 0;
  const ManualPump &mp = cs.manual_pumps[k];
  if (mp.flow_mask == 0) return 2;  // no local flow sensor -> dry-run unprotectable
  if (check_precheck(in, mp.src_tank, mp.src_min, 0xFF, 0) == 3) return 1;
  return 0;
}

void manual_pump_guard_tick(ControlState &cs, const Inputs &in) {
  uint32_t now = in.now_ms;
  uint32_t flow_watchdog = in.flow_watchdog_ms;  // shell resolves the default/floor
  float flow_threshold = in.flow_threshold_l_min;
  for (int k = 0; k < (int) cs.manual_pumps.size(); k++) {
    const ManualPump &mp = cs.manual_pumps[k];
    // manual_claim_bits is 32 wide; pump 32+ reads as no-claim (fail-safe: won't auto-run).
    bool claim = k < 32 && ((in.manual_claim_bits >> k) & 1u);
    bool claim_only = pump_ref_count(cs, mp.relay_idx) == 0 && claim;
    if (!claim_only) { cs.manual_run_since[k] = 0; cs.manual_latch[k] = 0; continue; }
    if (in.safety_override) { cs.manual_run_since[k] = 0; continue; }
    if (cs.manual_latch[k] != 0) continue;
    if (cs.manual_run_since[k] == 0) { cs.manual_run_since[k] = now; cs.manual_last_flow[k] = now; }
    uint32_t runtime = now - cs.manual_run_since[k];
    if (mp.flow_mask) {
      bool flow = false;
      // flow_mask is uint16; at() returns NaN for any sensor the shell didn't provide,
      // so this never depends on flow_rates being a particular length.
      for (int i = 0; i < 16; i++)
        if (mp.flow_mask & (1 << i)) {
          float f = at(in.flow_rates, i);
          if (!std::isnan(f) && f >= flow_threshold) { flow = true; break; }
        }
      if (flow) cs.manual_last_flow[k] = now;
      if (runtime > flow_watchdog && now - cs.manual_last_flow[k] > flow_watchdog) {
        cs.manual_latch[k] = STOP_NO_FLOW;
        continue;
      }
    }
    if (runtime > mp.max_rt_ms) cs.manual_latch[k] = STOP_MAX_RUNTIME;
  }
}

}  // namespace maji_ctl
