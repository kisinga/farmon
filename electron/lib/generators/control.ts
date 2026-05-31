import type { Manifest } from "../schema.js";
import { localNodesWithFlag, nodesWithFlag, slug } from "../schema.js";
import { SYSTEM_ENTITY_NAMES, routeEntityNames } from '@far-mon/core';

const SYS = SYSTEM_ENTITY_NAMES;

export function generateControl(m: Manifest): string {
  const localPumps = nodesWithFlag(m.nodes, 'isPump');
  const importedPumps = nodesWithFlag(m.imports, 'isPump');
  const allPumps = [...localPumps, ...importedPumps];

  // Conditional pump management in the transition interval.
  // Local pumps: drive relay directly + honor deadman claims.
  // Imported pumps: toggle proxy switch; the proxy sends node_claim /
  // node_release to the owning controller, which turns on its local relay.
  const pumpMgmt = allPumps.length > 0 ? `
          // --- Pump management ---
${allPumps.map((p, i) => {
  const isLocal = localPumps.some(lp => lp.id === p.id);
  const claimCheck = isLocal ? ` || has_live_claim("${p['id']}_relay")` : '';
  return `          bool need_pump_${i} = pump_ref_count(${i}) > 0${claimCheck};
          if (need_pump_${i} && !id(${p['id']}_relay).state) id(${p['id']}_relay).turn_on();
          else if (!need_pump_${i} && id(${p['id']}_relay).state) id(${p['id']}_relay).turn_off();`;
}).join('\n')}` : "";

  const pumpOffBoot = localPumps.map(p => `\n      - switch.turn_off: ${p['id']}_relay`).join("");

  // Dead-man enforcement for all local actuators
  const actuators = [
    ...localNodesWithFlag(m, 'isPump'),
    ...localNodesWithFlag(m, 'isValve'),
    ...localNodesWithFlag(m, 'isDosingPump'),
  ];
  const deadmanEnforcement = actuators.length > 0
    ? `\n          // --- Dead-man enforcement ---
${actuators.map(a => `          enforce_deadman("${a['id']}");`).join('\n')}`
    : "";

  return `# =============================================================================
# MajiFlow — Control Layer
# =============================================================================
# The brain: API services, slot-based state machine, safety watchdog.
#
# Slot states: IDLE(0) → PREPARING(1) → RUNNING(2) → STOPPING(3) → IDLE(0)
#                                └──────→ FAULT(4) ←──────┘
#
# Up to MAX_CONCURRENT_ROUTES (2) routes can execute simultaneously in
# independent slots. Routes sharing a flow sensor are queued (ambiguous
# readings). Shared valves are refcounted — closed only when no route needs them.
#
# All safety-critical logic lives HERE on the ESP32, not in HA.
# HA selects routes and requests start/stop via API services.
#
# Topology is defined in routes.h — this file never references specific
# valve/tank/flow IDs. All routing goes through ROUTES[], slots[], and
# dispatch functions.
# =============================================================================

# --- Globals -----------------------------------------------------------------

globals:
  - id: system_state
    type: int
    initial_value: "0"
    # Derived from slots — highest priority state across all slots.
    # 0=IDLE, 1=PREPARING, 2=RUNNING, 3=STOPPING, 4=FAULT

  - id: api_client_count
    type: int
    initial_value: "0"

  - id: stop_reason
    type: int
    initial_value: "0"
    # Most recent stop reason across all slots. Persists across runs.
    # 0=none  1=manual  2=tank_full  3=no_flow  4=max_runtime  5=api_lost

  - id: active_slot
    type: int
    initial_value: "-1"
    # Primary slot for OLED display. -1 = none active.

# --- API + Services ----------------------------------------------------------

api:
  encryption:
    key: !secret api_key
  on_client_connected:
    - lambda: |-
        id(api_client_count)++;
        ESP_LOGI("api", "API client connected (%d active)", id(api_client_count));
  on_client_disconnected:
    - lambda: |-
        if (id(api_client_count) > 0) id(api_client_count)--;
        ESP_LOGW("api", "API client disconnected (%d active)", id(api_client_count));
  services:
    - service: route_start
      variables:
        route_id: int
      then:
        - lambda: |-
            const char* results[] = {"started", "queued", "rejected", "source low", "dest full"};
            int r = try_route_start(route_id);
            if (r == 0) {
              ESP_LOGI("ctrl", "API start route %d [%s]: %s", route_id,
                       (route_id >= 0 && route_id < NUM_ROUTES) ? ROUTES[route_id].name : "?", results[r]);
            } else {
              ESP_LOGW("ctrl", "API start route %d: %s", route_id, (r >= 0 && r <= 4) ? results[r] : "?");
            }

    - service: route_stop
      variables:
        route_id: int
      then:
        - lambda: |-
            const char* results[] = {"stopping", "not active", "already idle/stopping"};
            int r = try_route_stop(route_id);
            ESP_LOGI("ctrl", "API stop route %d: %s", route_id, (r >= 0 && r <= 2) ? results[r] : "?");

    - service: fault_reset
      variables:
        route_id: int
      then:
        - lambda: |-
            int s = find_slot_by_route(route_id);
            if (s < 0 || slots[s].state != 4) return;
            init_slot(s);
            id(system_state) = derived_system_state();
            ESP_LOGI("ctrl", "Fault cleared for route %d → slot %d free", route_id, s);

    - service: node_claim
      variables:
        node_id: string
        owner: string
        duration_ms: int
      then:
        - lambda: |-
            extend_deadman(node_id, owner, duration_ms);
            ESP_LOGI("claim", "Claim %s by %s for %u ms", node_id.c_str(), owner.c_str(), duration_ms);

    - service: node_release
      variables:
        node_id: string
        owner: string
      then:
        - lambda: |-
            drop_claim(node_id, owner);
            ESP_LOGI("claim", "Released %s by %s", node_id.c_str(), owner.c_str());

# --- Safety override ---------------------------------------------------------

switch:
  - platform: template
    name: "${SYS.safetyOverride.name}"
    id: safety_override
    optimistic: true
    restore_mode: ALWAYS_OFF

# --- Button entities ---------------------------------------------------------
# Per-route Start/Stop and parameterless system-wide control actions.
# All first-class HA entities, trivially automatable. Parameterized actions
# (route_start, route_stop, fault_reset taking route_id) stay as api services
# above because buttons can't accept arguments.

button:
  - platform: template
    name: "${SYS.stopAll.name}"
    id: btn_stop_all
    icon: "mdi:stop-circle"
    on_press:
      - lambda: |-
          for (int s = 0; s < MAX_CONCURRENT_ROUTES; s++) {
            if (slots[s].state >= 1 && slots[s].state <= 2) {
              slots[s].stop_reason = STOP_MANUAL;
              slots[s].state = 3;
              slots[s].stop_time = millis();
            }
          }
          queue_head = 0; queue_count = 0;
          id(system_state) = derived_system_state();
          ESP_LOGI("ctrl", "Stop all requested");

  - platform: template
    name: "${SYS.resetFaults.name}"
    id: btn_reset_faults
    icon: "mdi:alert-circle-check"
    on_press:
      - lambda: |-
          for (int s = 0; s < MAX_CONCURRENT_ROUTES; s++) {
            if (slots[s].state == 4) init_slot(s);
          }
          id(system_state) = derived_system_state();
          ESP_LOGI("ctrl", "All faults cleared");

  - platform: template
    name: "${SYS.clearQueue.name}"
    id: btn_clear_queue
    icon: "mdi:tray-remove"
    on_press:
      - lambda: |-
          queue_head = 0; queue_count = 0;
          ESP_LOGI("ctrl", "Queue cleared");

${m.routes.map((r, i) => `\
  - platform: template
    name: "${routeEntityNames(r).start.name}"
    id: route_${i}_start
    icon: "mdi:play-circle"
    on_press:
      - lambda: |-
          const char* res[] = {"started","queued","rejected","source low","dest full"};
          int rc = try_route_start(${i});
          ESP_LOGI("btn", "Route ${i} [${r.name}] start: %s", res[rc]);
  - platform: template
    name: "${routeEntityNames(r).stop.name}"
    id: route_${i}_stop
    icon: "mdi:stop-circle"
    on_press:
      - lambda: |-
          const char* res[] = {"stopping","not active","already idle"};
          int rc = try_route_stop(${i});
          ESP_LOGI("btn", "Route ${i} [${r.name}] stop: %s", res[rc]);`).join("\n")}

# --- 1s Transition Interval --------------------------------------------------
# Handles: PREPARING→RUNNING, STOPPING→IDLE, pump management, queue drain,
#          derived state update, valve reconciliation.
#
# Valve actuation is level-triggered: reconcile_valves() runs at the end of
# each tick and emits open/close commands for any valve whose desired state
# (derived from active slot claims) doesn't match what was last commanded.

interval:
  - interval: 1s
    then:
      - lambda: |-
          uint32_t now = millis();

          for (int s = 0; s < MAX_CONCURRENT_ROUTES; s++) {
            int rid = slots[s].route_id;
            if (rid < 0) continue;

            // PREPARING → RUNNING (valve travel complete)
            if (slots[s].state == 1) {
              if (now - slots[s].start_time > get_route_travel_ms(rid) + 1000) {
                slots[s].state = 2;
                slots[s].run_start_time = now;
                slots[s].api_lost_since = (id(api_client_count) == 0) ? now : 0;
                slots[s].flow_active_since = 0;
                slots[s].last_flow_time = now;
                slots[s].flow_confirmed = false;
                ESP_LOGI("ctrl", "RUNNING slot %d route %d [%s]", s, rid, ROUTES[rid].name);
              }
            }

            // STOPPING → IDLE (depressurize + valve close travel complete)
            // Valve close itself happens via the reconciler once the slot's
            // claim drops at end of depressurize.
            if (slots[s].state == 3) {
              if (now - slots[s].stop_time > DEPRESSURIZE_MS + get_route_travel_ms(rid) + 1000) {
                id(stop_reason) = slots[s].stop_reason;
                ESP_LOGI("ctrl", "IDLE slot %d (reason=%d)", s, slots[s].stop_reason);
                init_slot(s);
              }
            }

            // FAULT slots stay in FAULT until fault_reset. Valves close via
            // the reconciler once the depressurize window elapses.
          }
${pumpMgmt}

          // --- Queue drain ---
          while (queue_count > 0) {
            int next = queue_peek(0);
            if (next < 0 || next >= NUM_ROUTES) { queue_pop(); continue; }
            if (find_slot_by_route(next) != -1) { queue_pop(); continue; }
            if (has_conflict(next) || find_free_slot() == -1) break;
            queue_pop();
            int slot = find_free_slot();
            init_slot(slot);
            slots[slot].route_id = next;
            slots[slot].state = 1;
            slots[slot].start_time = millis();
            // Valves open via the reconciler at the end of this tick.
            ESP_LOGI("ctrl", "Queue -> slot %d route %d [%s]", slot, next, ROUTES[next].name);
          }

          // --- Update derived state ---
          id(system_state) = derived_system_state();

          // --- Update active_slot for OLED ---
          id(active_slot) = -1;
          for (int s = 0; s < MAX_CONCURRENT_ROUTES; s++)
            if (slots[s].state >= 1 && slots[s].state <= 3) { id(active_slot) = s; break; }

          // --- Valve reconciliation (level-triggered, last step) ---
          reconcile_valves();${deadmanEnforcement}

  # --- 2s Safety Monitor -------------------------------------------------------
  # Per-slot watchdogs: flow, max runtime, API loss.

  - interval: 2s
    then:
      - lambda: |-
          if (id(safety_override).state) return;
          uint32_t now = millis();
          // HA tunables are operator-facing units (seconds, L/min). Convert
          // time-based fields to ms for the internal control loop. Bound
          // checks are in operator units; values below the bound fall back
          // to the manifest-baked DEFAULT_*_MS firmware constants.
          float flow_watchdog_state = id(flow_watchdog_s).state;
          float flow_confirm_state = id(flow_confirm_s).state;
          float flow_threshold_state = id(flow_threshold_l_min).state;
          float api_watchdog_state = id(api_watchdog_s).state;
          uint32_t flow_watchdog = (!std::isnan(flow_watchdog_state) && flow_watchdog_state >= 5.0f)
            ? (uint32_t)(flow_watchdog_state * 1000.0f) : DEFAULT_FLOW_WATCHDOG_MS;
          uint32_t flow_confirm = (!std::isnan(flow_confirm_state) && flow_confirm_state >= 3.0f)
            ? (uint32_t)(flow_confirm_state * 1000.0f) : DEFAULT_FLOW_CONFIRM_MS;
          float flow_threshold = (!std::isnan(flow_threshold_state) && flow_threshold_state >= 0.1f)
            ? flow_threshold_state : DEFAULT_FLOW_THRESHOLD_L_MIN;
          uint32_t api_watchdog = (!std::isnan(api_watchdog_state) && api_watchdog_state >= 30.0f)
            ? (uint32_t)(api_watchdog_state * 1000.0f) : DEFAULT_API_WATCHDOG_MS;

          for (int s = 0; s < MAX_CONCURRENT_ROUTES; s++) {
            if (slots[s].state != 2) continue;
            int rid = slots[s].route_id;
            if (rid < 0 || rid >= NUM_ROUTES) continue;
            const Route& r = ROUTES[rid];
            uint32_t runtime = now - slots[s].run_start_time;

            // --- FLOW SAMPLING (monitored routes only) ---
            if (r.flow_sensor != 0xFF) {
              float flow = get_flow_rate(r.flow_sensor);
              if (!std::isnan(flow) && flow >= flow_threshold) {
                if (slots[s].flow_active_since == 0) slots[s].flow_active_since = now;
                slots[s].last_flow_time = now;
                if (!slots[s].flow_confirmed && now - slots[s].flow_active_since >= flow_confirm) {
                  slots[s].flow_confirmed = true;
                  ESP_LOGI("safety", "Flow confirmed on slot %d route [%s]: %.2f L/min",
                           s, r.name, flow);
                }
              } else {
                slots[s].flow_active_since = 0;
              }

              // --- FLOW WATCHDOG ---
              if (slots[s].fault_code == 0 && runtime > flow_watchdog) {
                uint32_t age = now - slots[s].last_flow_time;
                if (age > flow_watchdog) {
                  if (slots[s].flow_confirmed) {
                    // Flow was established then stopped → tank full
                    ESP_LOGI("safety", "Tank full on slot %d route [%s]: flow stopped %us ago",
                             s, r.name, age / 1000);
                    slots[s].tank_full_detected = true;
                  } else {
                    // Flow was never established → genuine fault
                    ESP_LOGE("safety", "No flow for %us on slot %d route [%s]",
                             age / 1000, s, r.name);
                    slots[s].fault_code = FAULT_NO_FLOW;
                  }
                }
              }
            }

            // --- RUNTIME LEVEL CHECKS ---
            // Level sensors are intrinsically tank-mounted and unconditionally
            // pump-safe. Pressure sensors carry a placement flag, so this
            // block only runs when r.runtime_level_ok says the route's
            // pressure-derived readings are reliable during pump operation.
            // Thresholds come from HA-tunable getters; 0 means "skip the
            // check". safety_override bypasses the runtime stops the same
            // way it bypasses the pre-start guards in try_route_start.
            if (slots[s].fault_code == 0 && r.runtime_level_ok && !id(safety_override).state) {
              uint8_t src_min = get_route_source_min_pct(slots[s].route_id);
              uint8_t dst_max = get_route_dest_max_pct(slots[s].route_id);
              if (src_min > 0 && r.source_tank != 0xFF) {
                float src = get_tank_level(r.source_tank);
                if (!std::isnan(src) && src < (float)src_min) {
                  slots[s].stop_reason = STOP_SOURCE_LOW;
                  slots[s].state = 3;
                  slots[s].stop_time = now;
                  ESP_LOGI("safety", "Source low (%.0f%% < %u%%) — clean stop slot %d route [%s]",
                           src, src_min, s, r.name);
                }
              }
              if (slots[s].state == 2 && dst_max > 0 && r.dest_tank != 0xFF) {
                float dst = get_tank_level(r.dest_tank);
                if (!std::isnan(dst) && dst >= (float)dst_max) {
                  slots[s].stop_reason = STOP_TANK_FULL;
                  slots[s].state = 3;
                  slots[s].stop_time = now;
                  ESP_LOGI("safety", "Dest full (%.0f%% >= %u%%) — clean stop slot %d route [%s]",
                           dst, dst_max, s, r.name);
                }
              }
            }

            // --- PER-ROUTE MAX RUNTIME ---
            {
              uint16_t max_rt = get_max_runtime_s(slots[s].route_id);
              if (slots[s].fault_code == 0 && runtime > ((uint32_t)max_rt * 1000U)) {
                ESP_LOGE("safety", "Max runtime %us exceeded on slot %d route [%s]",
                         max_rt, s, r.name);
                slots[s].fault_code = FAULT_MAX_RUNTIME;
              }
            }

            // --- API WATCHDOG ---
            if (slots[s].fault_code == 0) {
              if (id(api_client_count) > 0) {
                slots[s].api_lost_since = 0;
              } else {
                if (slots[s].api_lost_since == 0) slots[s].api_lost_since = now;
                uint32_t age = now - slots[s].api_lost_since;
                if (age > api_watchdog) {
                  ESP_LOGE("safety", "API lost %us during slot %d route [%s]",
                           age / 1000, s, r.name);
                  slots[s].fault_code = FAULT_API_LOST;
                }
              }
            }

            // --- Act on fault ---
            if (slots[s].fault_code != 0) {
              // Force ESPHome's cover to resync its internal position estimate
              // by issuing stop_cover for every valve in this route. Without
              // this, the close that follows depressurize can be filtered as
              // a no-op if ESPHome already thinks the cover is at position 0.
              uint16_t fmask = ROUTES[rid].valve_mask;
              for (int i = 0; i < NUM_VALVES; i++)
                if (fmask & (1 << i)) stop_valve_hw(i);
              slots[s].stop_reason = slots[s].fault_code + FAULT_TO_STOP_OFFSET;
              slots[s].state = 4;  // FAULT
              slots[s].stop_time = now;
              ESP_LOGE("ctrl", "FAULT %d on slot %d route [%s]", slots[s].fault_code, s, r.name);
            }

            // --- Tank full → clean stop ---
            if (slots[s].tank_full_detected) {
              slots[s].stop_reason = STOP_TANK_FULL;
              slots[s].state = 3;  // STOPPING
              slots[s].stop_time = now;
              slots[s].tank_full_detected = false;
              ESP_LOGI("ctrl", "Tank full — clean stop slot %d route [%s]", s, r.name);
            }
          }
`;
}
