export const CONTROL_YAML = `# =============================================================================
# Pump Controller — Control Layer
# =============================================================================
# The brain: state machine, API services, sequencing scripts, safety watchdog.
#
# State machine: IDLE(0) → PREPARING(1) → RUNNING(2) → STOPPING(3) → IDLE(0)
#                                └──────→ FAULT(4) ←──────┘
#
# All safety-critical logic lives HERE on the ESP32, not in HA.
# HA only selects a route and requests start/stop.
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

  - id: pump_start_time
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
    # 0=none, 1=no_flow, 2=no_level_rise, 3=max_runtime,
    # 4=api_lost, 5=source_empty

  - id: refill_baseline_level
    type: float
    initial_value: "-1.0"
    # Sentinel: -1.0 means "not tracking" (non-refill ops skip level-rise watchdog)

  - id: refill_baseline_time
    type: uint32_t
    initial_value: "0"

  - id: flow_confirmed
    type: bool
    initial_value: "false"
    # True once flow > 0.5 L/min sustained for flow_confirm_seconds after pump start

  - id: tank_full_detected
    type: bool
    initial_value: "false"
    # Signal: no-flow detected but flow was previously confirmed → clean stop

  - id: stop_reason
    type: int
    initial_value: "0"
    # Persists across runs so HA can show why the pump last stopped.
    # 0=none  1=manual  2=tank_full  3=no_flow  4=no_rise
    # 5=max_runtime  6=api_lost  7=source_empty

# --- API + Services ----------------------------------------------------------

api:
  encryption:
    key: !secret api_key
  on_client_connected:
    - lambda: 'id(api_lost_time) = 0;'
  on_client_disconnected:
    - lambda: 'id(api_lost_time) = millis();'
  services:
    - service: pump_start
      variables:
        route_id: int
      then:
        - lambda: |-
            if (id(system_state) != 0) {
              ESP_LOGW("pump", "Rejected: state=%d, need IDLE", id(system_state));
              return;
            }
            if (route_id < 0 || route_id >= NUM_ROUTES) {
              ESP_LOGW("pump", "Rejected: invalid route_id=%d (max %d)", route_id, NUM_ROUTES - 1);
              return;
            }
            const Route& r = ROUTES[route_id];
            if (r.source_tank != 0xFF) {
              float src = get_tank_level(r.source_tank);
              if (!id(safety_override).state && (std::isnan(src) || src < 5.0f)) {
                ESP_LOGW("pump", "Rejected: source tank %d at %.0f%%", r.source_tank, src);
                id(fault_code) = 5;
                id(system_state) = 4;
                return;
              }
            }
            id(active_route) = route_id;
            id(fault_code) = 0;
            id(system_state) = 1;
            ESP_LOGI("pump", "Start route %d [%s]", route_id, r.name);
        - if:
            condition:
              lambda: 'return id(system_state) == 1;'
            then:
              - script.execute: do_prepare_and_run

    - service: pump_stop
      then:
        - lambda: |-
            if (id(system_state) == 0 || id(system_state) == 3) return;
            id(stop_reason) = 1;  // manual
            ESP_LOGI("pump", "Stop requested");
        - script.execute: do_stop

    - service: fault_reset
      then:
        - lambda: |-
            if (id(system_state) != 4) return;
            id(fault_code) = 0;
            id(system_state) = 0;
            id(active_route) = -1;
            ESP_LOGI("pump", "Fault cleared → IDLE");

# --- Safety override ---------------------------------------------------------
# When ON, all runtime watchdogs are bypassed and low-source check is skipped.
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
      - switch.turn_off: pump_relay
      - delay: 500ms
      # Close everything first
      - script.execute: close_all_valves
      - script.wait: close_all_valves
      # Abort if pump_stop was called while valves were moving
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
      # Abort if pump_stop was called while valves were moving
      - if:
          condition: {lambda: 'return id(system_state) != 1;'}
          then: [{script.stop: do_prepare_and_run}]
      # Transition to RUNNING and arm watchdogs
      - lambda: |-
          const Route& r = ROUTES[id(active_route)];
          id(flow_confirmed) = false;
          id(tank_full_detected) = false;
          id(system_state) = 2;
          id(pump_start_time) = millis();
          id(last_flow_time) = millis();
          if (r.watchdog == WD_LEVEL_RISE && r.dest_tank != 0xFF) {
            id(refill_baseline_level) = get_tank_level(r.dest_tank);
            id(refill_baseline_time) = millis();
          } else {
            id(refill_baseline_level) = -1.0f;  // sentinel: not tracking
          }
          ESP_LOGI("pump", "RUNNING route %d [%s] — watchdog=%d", id(active_route), r.name, r.watchdog);
      - switch.turn_on: pump_relay

  # Caller (pump_stop service) already guards against IDLE/STOPPING
  - id: do_stop
    mode: single
    then:
      - lambda: 'id(system_state) = 3;'
      - switch.turn_off: pump_relay
      - delay: 2s   # depressurize before closing valves
      - script.execute: close_all_valves
      - script.wait: close_all_valves
      - lambda: |-
          id(system_state) = 0;
          id(active_route) = -1;
          id(flow_confirmed) = false;
          id(tank_full_detected) = false;
          ESP_LOGI("pump", "IDLE");

  - id: do_fault
    mode: single
    then:
      - lambda: 'id(system_state) = 4;'
      - switch.turn_off: pump_relay
      - delay: 2s   # passive depressurization before closing valves
      - script.execute: close_all_valves
      - script.wait: close_all_valves
      - lambda: |-
          id(flow_confirmed) = false;
          id(tank_full_detected) = false;
          ESP_LOGE("pump", "FAULT %d — awaiting reset", id(fault_code));

# --- Safety monitor — runs every 2s -----------------------------------------
# Watchdog strategy is determined by ROUTES[active_route].watchdog:
#   WD_FLOW:       flow sensor must see pulses within flow_watchdog_seconds
#   WD_LEVEL_RISE: dest tank level must rise ≥ refill_min_rise_pct per window
#   WD_RUNTIME:    no path-specific sensor — only max_runtime protects

interval:
  - interval: 2s
    then:
      - lambda: |-
          if (id(system_state) != 2) return;
          if (id(safety_override).state) return;
          if (id(active_route) < 0 || id(active_route) >= NUM_ROUTES) return;
          uint32_t now = millis();
          uint32_t runtime = now - id(pump_start_time);
          const Route& r = ROUTES[id(active_route)];

          // --- WATCHDOG: path-dependent ---
          if (id(fault_code) == 0) {
            switch (r.watchdog) {

              case WD_FLOW: {
                if (r.flow_sensor == 0xFF) break;  // misconfigured — skip
                if (runtime > (\${flow_watchdog_seconds} * 1000U)) {
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
                      id(fault_code) = 1;
                    }
                  }
                }
                break;
              }

              case WD_LEVEL_RISE: {
                if (r.dest_tank == 0xFF) break;  // misconfigured — skip
                if (runtime > (\${refill_watchdog_seconds} * 1000U)) {
                  float current = get_tank_level(r.dest_tank);
                  float baseline = id(refill_baseline_level);
                  uint32_t baseline_age = now - id(refill_baseline_time);
                  if (baseline_age > (\${refill_watchdog_seconds} * 1000U)) {
                    float rise = current - baseline;
                    if (rise < \${refill_min_rise_pct}) {
                      ESP_LOGE("safety", "Level rise %.1f%% < %.1f%% in %us on route %d [%s]",
                               rise, (float)\${refill_min_rise_pct}, baseline_age / 1000,
                               id(active_route), r.name);
                      id(fault_code) = 2;
                    } else {
                      // Reset baseline for next window
                      id(refill_baseline_level) = current;
                      id(refill_baseline_time) = now;
                    }
                  }
                }
                break;
              }

              case WD_RUNTIME:
                // No path-specific watchdog — max_runtime still applies below
                break;
            }
          }

          // --- MAX RUNTIME ---
          if (id(fault_code) == 0 && runtime > (\${max_runtime_seconds} * 1000U)) {
            ESP_LOGE("safety", "Max runtime exceeded on route %d [%s]", id(active_route), r.name);
            id(fault_code) = 3;
          }

          // --- API WATCHDOG ---
          if (id(fault_code) == 0 && id(api_lost_time) > 0) {
            uint32_t age = now - id(api_lost_time);
            if (age > (\${api_watchdog_seconds} * 1000U)) {
              ESP_LOGE("safety", "API lost %us", age / 1000);
              id(fault_code) = 4;
            }
          }

          // --- SOURCE TANK DEPLETED ---
          if (id(fault_code) == 0 && r.source_tank != 0xFF) {
            float lvl = get_tank_level(r.source_tank);
            if (lvl < 3.0f) {
              ESP_LOGE("safety", "Source tank %d depleted: %.0f%% on route %d [%s]",
                       r.source_tank, lvl, id(active_route), r.name);
              id(fault_code) = 5;
            }
          }

      - if:
          condition:
            lambda: 'return id(system_state) == 2 && id(fault_code) != 0;'
          then:
            - lambda: 'id(stop_reason) = id(fault_code) + 2;'
            - script.execute: do_fault
      - if:
          condition:
            lambda: 'return id(system_state) == 2 && id(tank_full_detected);'
          then:
            - lambda: |-
                ESP_LOGI("pump", "Tank full — clean stop");
                id(tank_full_detected) = false;
                id(stop_reason) = 2;  // tank full
            - script.execute: do_stop
`;
