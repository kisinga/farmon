import type { Manifest } from "../schema.js";
import { nodesByKind } from "../schema.js";

export function generateControl(m: Manifest): string {
  const hasPump = nodesByKind(m.nodes, 'pump').length > 0;

  // Conditional pump management in the transition interval
  const pumpMgmt = hasPump ? `
          // --- Pump management ---
          bool need_pump = pump_ref_count() > 0;
          if (need_pump && !id(pump_relay).state) id(pump_relay).turn_on();
          else if (!need_pump && id(pump_relay).state) id(pump_relay).turn_off();` : "";

  const pumpOffBoot = hasPump ? `\n      - switch.turn_off: pump_relay` : "";

  return `# =============================================================================
# MajiFlow — Control Layer
# =============================================================================
# The brain: API services, slot-based state machine, safety watchdog.
#
# Slot states: IDLE(0) → PREPARING(1) → RUNNING(2) → STOPPING(3) → IDLE(0)
#                                └──────→ FAULT(4) ←──────┘
#
# Up to MAX_CONCURRENT_ROUTES (2) routes can execute simultaneously in
# independent slots. Routes with conflicting valves are queued automatically.
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

  - id: api_lost_time
    type: uint32_t
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
    - lambda: 'id(api_lost_time) = 0;'
  on_client_disconnected:
    - lambda: 'id(api_lost_time) = millis();'
  services:
    - service: route_start
      variables:
        route_id: int
      then:
        - lambda: |-
            // Validate route_id
            if (route_id < 0 || route_id >= NUM_ROUTES) {
              ESP_LOGW("ctrl", "Rejected: invalid route_id=%d", route_id);
              return;
            }
            // Reject if already active
            if (find_slot_by_route(route_id) != -1) {
              ESP_LOGW("ctrl", "Rejected: route %d already active", route_id);
              return;
            }
            // Check valve conflict or no free slot → queue
            if (has_valve_conflict(route_id) || find_free_slot() == -1) {
              if (queue_push(route_id)) {
                ESP_LOGI("ctrl", "Queued route %d [%s] (conflict or no slot)", route_id, ROUTES[route_id].name);
              } else {
                ESP_LOGW("ctrl", "Rejected: queue full, cannot enqueue route %d", route_id);
              }
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
            // Allocate slot
            int slot = find_free_slot();
            init_slot(slot);
            slots[slot].route_id = route_id;
            slots[slot].state = 1;  // PREPARING
            slots[slot].start_time = millis();
            // Open route valves
            for (int i = 0; i < NUM_VALVES; i++) {
              if (r.valve_mask & (1 << i)) open_valve_hw(i);
            }
            if (id(active_slot) == -1) id(active_slot) = slot;
            id(system_state) = derived_system_state();
            ESP_LOGI("ctrl", "Start route %d [%s] in slot %d", route_id, r.name, slot);

    - service: route_stop
      variables:
        route_id: int
      then:
        - lambda: |-
            int s = find_slot_by_route(route_id);
            if (s < 0) {
              ESP_LOGW("ctrl", "route_stop: route %d not active", route_id);
              return;
            }
            if (slots[s].state == 0 || slots[s].state == 3) return;
            slots[s].stop_reason = STOP_MANUAL;
            slots[s].state = 3;  // STOPPING
            slots[s].stop_time = millis();
            slots[s].valves_closing = false;
            id(system_state) = derived_system_state();
            ESP_LOGI("ctrl", "Stop requested for route %d slot %d", route_id, s);

    - service: stop_all
      then:
        - lambda: |-
            for (int s = 0; s < MAX_CONCURRENT_ROUTES; s++) {
              if (slots[s].state >= 1 && slots[s].state <= 2) {
                slots[s].stop_reason = STOP_MANUAL;
                slots[s].state = 3;
                slots[s].stop_time = millis();
                slots[s].valves_closing = false;
              }
            }
            queue_head = 0; queue_count = 0;
            id(system_state) = derived_system_state();
            ESP_LOGI("ctrl", "Stop all requested");

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

    - service: fault_reset_all
      then:
        - lambda: |-
            for (int s = 0; s < MAX_CONCURRENT_ROUTES; s++) {
              if (slots[s].state == 4) init_slot(s);
            }
            id(system_state) = derived_system_state();
            ESP_LOGI("ctrl", "All faults cleared");

    - service: queue_clear
      then:
        - lambda: |-
            queue_head = 0; queue_count = 0;
            ESP_LOGI("ctrl", "Queue cleared");

# --- Safety override ---------------------------------------------------------

switch:
  - platform: template
    name: "Safety Override"
    id: safety_override
    optimistic: true
    restore_mode: ALWAYS_OFF

# --- 1s Transition Interval --------------------------------------------------
# Handles: PREPARING→RUNNING, STOPPING→IDLE, FAULT valve close,
#          pump management, queue drain, derived state update.

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
              if (now - slots[s].start_time > VALVE_TRAVEL_MS + 1000) {
                slots[s].state = 2;
                slots[s].run_start_time = now;
                slots[s].last_flow_time = now;
                slots[s].flow_confirmed = false;
                ESP_LOGI("ctrl", "RUNNING slot %d route %d [%s]", s, rid, ROUTES[rid].name);
              }
            }

            // STOPPING/FAULT → close valves after depressurize
            if ((slots[s].state == 3 || slots[s].state == 4) && !slots[s].valves_closing) {
              if (now - slots[s].stop_time > DEPRESSURIZE_MS) {
                uint16_t mask = ROUTES[rid].valve_mask;
                for (int i = 0; i < NUM_VALVES; i++)
                  if (mask & (1 << i)) close_valve_hw(i);
                slots[s].valves_closing = true;
              }
            }

            // STOPPING → IDLE (valve close complete)
            if (slots[s].state == 3 && slots[s].valves_closing) {
              if (now - slots[s].stop_time > DEPRESSURIZE_MS + VALVE_TRAVEL_MS + 1000) {
                id(stop_reason) = slots[s].stop_reason;
                ESP_LOGI("ctrl", "IDLE slot %d (reason=%d)", s, slots[s].stop_reason);
                init_slot(s);
              }
            }

            // Note: FAULT slots stay in FAULT with valves closed until fault_reset
          }
${pumpMgmt}

          // --- Queue drain ---
          while (queue_count > 0) {
            int next = queue_peek(0);
            if (next < 0 || next >= NUM_ROUTES) { queue_pop(); continue; }
            if (find_slot_by_route(next) != -1) { queue_pop(); continue; }
            if (has_valve_conflict(next) || find_free_slot() == -1) break;
            queue_pop();
            int slot = find_free_slot();
            init_slot(slot);
            slots[slot].route_id = next;
            slots[slot].state = 1;
            slots[slot].start_time = millis();
            uint16_t mask = ROUTES[next].valve_mask;
            for (int i = 0; i < NUM_VALVES; i++)
              if (mask & (1 << i)) open_valve_hw(i);
            ESP_LOGI("ctrl", "Queue -> slot %d route %d [%s]", slot, next, ROUTES[next].name);
          }

          // --- Update derived state ---
          id(system_state) = derived_system_state();

          // --- Update active_slot for OLED ---
          id(active_slot) = -1;
          for (int s = 0; s < MAX_CONCURRENT_ROUTES; s++)
            if (slots[s].state >= 1 && slots[s].state <= 3) { id(active_slot) = s; break; }

  # --- 2s Safety Monitor -------------------------------------------------------
  # Per-slot watchdogs: flow, max runtime, API loss.

  - interval: 2s
    then:
      - lambda: |-
          if (id(safety_override).state) return;
          uint32_t now = millis();

          for (int s = 0; s < MAX_CONCURRENT_ROUTES; s++) {
            if (slots[s].state != 2) continue;
            int rid = slots[s].route_id;
            if (rid < 0 || rid >= NUM_ROUTES) continue;
            const Route& r = ROUTES[rid];
            uint32_t runtime = now - slots[s].run_start_time;

            // --- FLOW WATCHDOG ---
            if (slots[s].fault_code == 0 && runtime > FLOW_WATCHDOG_MS) {
              uint32_t age = now - slots[s].last_flow_time;
              if (age > FLOW_WATCHDOG_MS) {
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

            // --- PER-ROUTE MAX RUNTIME ---
            if (slots[s].fault_code == 0 && runtime > ((uint32_t)r.max_runtime_s * 1000U)) {
              ESP_LOGE("safety", "Max runtime %us exceeded on slot %d route [%s]",
                       r.max_runtime_s, s, r.name);
              slots[s].fault_code = FAULT_MAX_RUNTIME;
            }

            // --- API WATCHDOG ---
            if (slots[s].fault_code == 0 && id(api_lost_time) > 0) {
              uint32_t age = now - id(api_lost_time);
              if (age > API_WATCHDOG_MS) {
                ESP_LOGE("safety", "API lost %us — faulting slot %d", age / 1000, s);
                slots[s].fault_code = FAULT_API_LOST;
              }
            }

            // --- Act on fault ---
            if (slots[s].fault_code != 0) {
              slots[s].stop_reason = slots[s].fault_code + FAULT_TO_STOP_OFFSET;
              slots[s].state = 4;  // FAULT
              slots[s].stop_time = now;
              slots[s].valves_closing = false;
              ESP_LOGE("ctrl", "FAULT %d on slot %d route [%s]", slots[s].fault_code, s, r.name);
            }

            // --- Tank full → clean stop ---
            if (slots[s].tank_full_detected) {
              slots[s].stop_reason = STOP_TANK_FULL;
              slots[s].state = 3;  // STOPPING
              slots[s].stop_time = now;
              slots[s].valves_closing = false;
              slots[s].tank_full_detected = false;
              ESP_LOGI("ctrl", "Tank full — clean stop slot %d route [%s]", s, r.name);
            }
          }
`;
}
