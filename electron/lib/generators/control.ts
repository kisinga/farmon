import type { Manifest } from "../schema.js";
import { nodesByKind } from "../schema.js";

function slug(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "")
    .replace(/_+/g, "_");
}

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

# --- Per-route button entities -----------------------------------------------
# Each route gets a Start and Stop button — first-class HA entities that are
# trivially automatable. All actions go through the state machine.

button:
${m.routes.map((r, i) => `\
  - platform: template
    name: "Start: ${r.name}"
    id: route_${i}_start
    icon: "mdi:play-circle"
    on_press:
      - lambda: |-
          const char* res[] = {"started","queued","rejected","source low","dest full"};
          int rc = try_route_start(${i});
          ESP_LOGI("btn", "Route ${i} [${r.name}] start: %s", res[rc]);
  - platform: template
    name: "Stop: ${r.name}"
    id: route_${i}_stop
    icon: "mdi:stop-circle"
    on_press:
      - lambda: |-
          const char* res[] = {"stopping","not active","already idle"};
          int rc = try_route_stop(${i});
          ESP_LOGI("btn", "Route ${i} [${r.name}] stop: %s", res[rc]);`).join("\n")}

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
            // Only close valves not needed by other active routes (actuator refcount).
            if ((slots[s].state == 3 || slots[s].state == 4) && !slots[s].valves_closing) {
              if (now - slots[s].stop_time > DEPRESSURIZE_MS) {
                uint16_t to_close = safe_close_mask(s);
                for (int i = 0; i < NUM_VALVES; i++)
                  if (to_close & (1 << i)) close_valve_hw(i);
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
            if (has_conflict(next) || find_free_slot() == -1) break;
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

            // --- RUNTIME LEVEL CHECKS (only when sensors are pump-rated) ---
            if (slots[s].fault_code == 0 && r.runtime_level_ok) {
              if (r.source_min_pct > 0 && r.source_tank != 0xFF) {
                float src = get_tank_level(r.source_tank);
                if (!std::isnan(src) && src < (float)r.source_min_pct) {
                  slots[s].stop_reason = STOP_SOURCE_LOW;
                  slots[s].state = 3;
                  slots[s].stop_time = now;
                  slots[s].valves_closing = false;
                  ESP_LOGI("safety", "Source low (%.0f%% < %u%%) — clean stop slot %d route [%s]",
                           src, r.source_min_pct, s, r.name);
                }
              }
              if (slots[s].state == 2 && r.dest_max_pct > 0 && r.dest_tank != 0xFF) {
                float dst = get_tank_level(r.dest_tank);
                if (!std::isnan(dst) && dst >= (float)r.dest_max_pct) {
                  slots[s].stop_reason = STOP_TANK_FULL;
                  slots[s].state = 3;
                  slots[s].stop_time = now;
                  slots[s].valves_closing = false;
                  ESP_LOGI("safety", "Dest full (%.0f%% >= %u%%) — clean stop slot %d route [%s]",
                           dst, r.dest_max_pct, s, r.name);
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
