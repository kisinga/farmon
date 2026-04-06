import type { Manifest } from "../schema.js";
import { nodesByKind } from "../schema.js";

export function generateControl(m: Manifest): string {
  const hasPump = nodesByKind(m.nodes, 'pump').length > 0;

  // Conditional pump relay actions
  const pumpOff = hasPump ? "      - switch.turn_off: pump_relay\n" : "";
  const pumpOn = hasPump ? "      - switch.turn_on: pump_relay\n" : "";

  return `# =============================================================================
# MajiFlow — Control Layer
# =============================================================================
# The brain: state machine, API services, sequencing scripts, safety watchdog.
#
# State machine: IDLE(0) → PREPARING(1) → RUNNING(2) → STOPPING(3) → IDLE(0)
#                                └──────→ FAULT(4) ←──────┘
#
# All safety-critical logic lives HERE on the ESP32, not in HA.
# HA only selects a route and requests start/stop.
#
# Every route has a flow sensor. The safety monitor uses flow-based
# watchdog unconditionally — no strategy dispatch needed.
#
# Topology is defined in routes.h — this file never references specific
# valve/tank/flow IDs. All routing goes through ROUTES[] and dispatch functions.
# =============================================================================

# --- Globals -----------------------------------------------------------------

globals:
  - id: system_state
    type: int
    initial_value: "0"
    # 0=IDLE, 1=PREPARING, 2=RUNNING, 3=STOPPING, 4=FAULT

  - id: active_route
    type: int
    initial_value: "-1"
    # Index into ROUTES[]. -1 = no active route.

  - id: route_start_time
    type: uint32_t
    initial_value: "0"

  - id: last_flow_time
    type: uint32_t
    initial_value: "0"

  - id: api_lost_time
    type: uint32_t
    initial_value: "0"

  - id: fault_code
    type: int
    initial_value: "0"
    # 0=none, 1=no_flow, 2=max_runtime, 3=api_lost

  - id: flow_confirmed
    type: bool
    initial_value: "false"
    # True once flow > 0.5 L/min sustained for flow_confirm_seconds after route start

  - id: tank_full_detected
    type: bool
    initial_value: "false"
    # Signal: no-flow detected but flow was previously confirmed → clean stop

  - id: stop_reason
    type: int
    initial_value: "0"
    # Persists across runs so HA can show why the last route stopped.
    # 0=none  1=manual  2=tank_full  3=no_flow  4=max_runtime  5=api_lost

# --- API + Services ----------------------------------------------------------

api:
  encryption:
    key: !secret api_key
  on_client_connected:
    - lambda: 'id(api_lost_time) = 0;'
  on_client_disconnected:
    - lambda: 'id(api_lost_time) = millis();'
  services:
    - service: route_start
      variables:
        route_id: int
      then:
        - lambda: |-
            if (id(system_state) != 0) {
              ESP_LOGW("ctrl", "Rejected: state=%d, need IDLE", id(system_state));
              return;
            }
            if (route_id < 0 || route_id >= NUM_ROUTES) {
              ESP_LOGW("ctrl", "Rejected: invalid route_id=%d (max %d)", route_id, NUM_ROUTES - 1);
              return;
            }
            const Route& r = ROUTES[route_id];
            // Pre-start: source tank must have enough water
            if (r.source_tank != 0xFF) {
              float src = get_tank_level(r.source_tank);
              if (!id(safety_override).state && (std::isnan(src) || src < 5.0f)) {
                ESP_LOGW("ctrl", "Rejected: source tank %d at %.0f%%", r.source_tank, src);
                return;
              }
            }
            // Pre-start: dest tank must not be full
            if (r.dest_tank != 0xFF) {
              float dst = get_tank_level(r.dest_tank);
              if (!id(safety_override).state && !std::isnan(dst) && dst > 95.0f) {
                ESP_LOGW("ctrl", "Rejected: dest tank %d at %.0f%%", r.dest_tank, dst);
                return;
              }
            }
            id(active_route) = route_id;
            id(fault_code) = 0;
            id(system_state) = 1;
            ESP_LOGI("ctrl", "Start route %d [%s]", route_id, r.name);
        - if:
            condition:
              lambda: 'return id(system_state) == 1;'
            then:
              - script.execute: do_prepare_and_run

    - service: route_stop
      then:
        - lambda: |-
            if (id(system_state) == 0 || id(system_state) == 3) return;
            id(stop_reason) = STOP_MANUAL;
            ESP_LOGI("ctrl", "Stop requested");
        - script.execute: do_stop

    - service: fault_reset
      then:
        - lambda: |-
            if (id(system_state) != 4) return;
            id(fault_code) = 0;
            id(system_state) = 0;
            id(active_route) = -1;
            ESP_LOGI("ctrl", "Fault cleared → IDLE");

# --- Safety override ---------------------------------------------------------
# When ON, all runtime watchdogs are bypassed and pre-start checks are skipped.
# Restores to OFF on every boot so it can't be left on accidentally.

switch:
  - platform: template
    name: "Safety Override"
    id: safety_override
    optimistic: true
    restore_mode: ALWAYS_OFF

# --- Scripts -----------------------------------------------------------------

script:
  # Close all valves via dispatch loop.
  - id: close_all_valves
    mode: single
    then:
      - lambda: |-
          for (int i = 0; i < NUM_VALVES; i++) {
            close_valve(i);
          }
      - delay: \${valve_travel_time}
      - delay: 1s   # extra settle time after motor stops

  - id: do_prepare_and_run
    mode: single
    then:
${pumpOff}\
      - delay: 500ms
      # Close everything first
      - script.execute: close_all_valves
      - script.wait: close_all_valves
      # Abort if route_stop was called while valves were moving
      - if:
          condition: {lambda: 'return id(system_state) != 1;'}
          then: [{script.stop: do_prepare_and_run}]
      # Open valves for the active route
      - lambda: |-
          const Route& r = ROUTES[id(active_route)];
          for (int i = 0; i < NUM_VALVES; i++) {
            if (r.valve_mask & (1 << i)) {
              open_valve(i);
            }
          }
      - delay: \${valve_travel_time}
      - delay: 1s   # settle
      # Abort if route_stop was called while valves were moving
      - if:
          condition: {lambda: 'return id(system_state) != 1;'}
          then: [{script.stop: do_prepare_and_run}]
      # Transition to RUNNING and arm watchdogs
      - lambda: |-
          const Route& r = ROUTES[id(active_route)];
          id(flow_confirmed) = false;
          id(tank_full_detected) = false;
          id(system_state) = 2;
          id(route_start_time) = millis();
          id(last_flow_time) = millis();
          ESP_LOGI("ctrl", "RUNNING route %d [%s] — max_runtime=%us", id(active_route), r.name, r.max_runtime_s);
${pumpOn}\

  # Caller (route_stop service) already guards against IDLE/STOPPING
  - id: do_stop
    mode: single
    then:
      - lambda: 'id(system_state) = 3;'
${pumpOff}\
      - homeassistant.event:
          event: esphome.majiflow_event
          data:
            type: stopped
          data_template:
            route: !lambda |-
              if (id(active_route) >= 0 && id(active_route) < NUM_ROUTES)
                return std::string(ROUTES[id(active_route)].name);
              return std::string("unknown");
            reason: !lambda |-
              const char* r[] = {"none","manual","tank_full","no_flow","max_runtime","api_lost"};
              int sr = id(stop_reason);
              return std::string((sr >= 0 && sr <= 5) ? r[sr] : "unknown");
      - delay: 2s   # depressurize before closing valves
      - script.execute: close_all_valves
      - script.wait: close_all_valves
      - lambda: |-
          id(system_state) = 0;
          id(active_route) = -1;
          id(flow_confirmed) = false;
          id(tank_full_detected) = false;
          ESP_LOGI("ctrl", "IDLE");

  - id: do_fault
    mode: single
    then:
      - lambda: 'id(system_state) = 4;'
${pumpOff}\
      - homeassistant.event:
          event: esphome.majiflow_event
          data:
            type: fault
          data_template:
            route: !lambda |-
              if (id(active_route) >= 0 && id(active_route) < NUM_ROUTES)
                return std::string(ROUTES[id(active_route)].name);
              return std::string("unknown");
            fault: !lambda |-
              const char* f[] = {"none","no_flow","max_runtime","api_lost"};
              int fc = id(fault_code);
              return std::string((fc >= 0 && fc <= 3) ? f[fc] : "unknown");
      - delay: 2s   # passive depressurization before closing valves
      - script.execute: close_all_valves
      - script.wait: close_all_valves
      - lambda: |-
          id(flow_confirmed) = false;
          id(tank_full_detected) = false;
          ESP_LOGE("ctrl", "FAULT %d — awaiting reset", id(fault_code));

# --- Safety monitor — runs every 2s -----------------------------------------
# Flow-based watchdog runs unconditionally on every route.
# Per-route max_runtime_s provides the hard ceiling.
# Tank readings are suppressed during route operation (handled in sensors.yaml).

interval:
  - interval: 2s
    then:
      - lambda: |-
          if (id(system_state) != 2) return;
          if (id(safety_override).state) return;
          if (id(active_route) < 0 || id(active_route) >= NUM_ROUTES) return;
          uint32_t now = millis();
          uint32_t runtime = now - id(route_start_time);
          const Route& r = ROUTES[id(active_route)];

          // --- FLOW WATCHDOG (unconditional) ---
          if (id(fault_code) == 0 && runtime > (\${flow_watchdog_seconds} * 1000U)) {
            uint32_t age = now - id(last_flow_time);
            if (age > (\${flow_watchdog_seconds} * 1000U)) {
              if (id(flow_confirmed)) {
                // Flow was established then stopped → tank full
                ESP_LOGI("safety", "Tank full on route %d [%s]: flow stopped %us ago",
                         id(active_route), r.name, age / 1000);
                id(tank_full_detected) = true;
              } else {
                // Flow was never established → genuine fault
                ESP_LOGE("safety", "No flow for %us on route %d [%s]",
                         age / 1000, id(active_route), r.name);
                id(fault_code) = FAULT_NO_FLOW;
              }
            }
          }

          // --- PER-ROUTE MAX RUNTIME ---
          if (id(fault_code) == 0 && runtime > ((uint32_t)r.max_runtime_s * 1000U)) {
            ESP_LOGE("safety", "Max runtime %us exceeded on route %d [%s]",
                     r.max_runtime_s, id(active_route), r.name);
            id(fault_code) = FAULT_MAX_RUNTIME;
          }

          // --- API WATCHDOG ---
          if (id(fault_code) == 0 && id(api_lost_time) > 0) {
            uint32_t age = now - id(api_lost_time);
            if (age > (\${api_watchdog_seconds} * 1000U)) {
              ESP_LOGE("safety", "API lost %us", age / 1000);
              id(fault_code) = FAULT_API_LOST;
            }
          }

      - if:
          condition:
            lambda: 'return id(system_state) == 2 && id(fault_code) != 0;'
          then:
            - lambda: 'id(stop_reason) = id(fault_code) + FAULT_TO_STOP_OFFSET;'
            - script.execute: do_fault
      - if:
          condition:
            lambda: 'return id(system_state) == 2 && id(tank_full_detected);'
          then:
            - lambda: |-
                ESP_LOGI("ctrl", "Tank full — clean stop");
                id(tank_full_detected) = false;
                id(stop_reason) = STOP_TANK_FULL;
            - script.execute: do_stop
`;
}
