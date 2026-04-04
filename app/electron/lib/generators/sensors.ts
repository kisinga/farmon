import type { Manifest } from "../schema.js";

export function generateSensors(m: Manifest): string {
  const flowBlocks = m.flow_sensors.map((f, i) => `\
  - platform: pulse_counter
    pin:
      number: \${pin_${f.id}}
      mode: INPUT_PULLUP
    id: ${f.id}
    name: "${f.name}"
    unit_of_measurement: "L/min"
    icon: "mdi:water"
    update_interval: \${update_interval}
    filters:
      - lambda: return x / \${flow_cal};
    on_value:
      - lambda: |-
          const int SENSOR_IDX = ${i};
          if (id(system_state) == 2 && id(active_route) >= 0 && id(active_route) < NUM_ROUTES) {
            const Route& r = ROUTES[id(active_route)];
            if (r.flow_sensor == SENSOR_IDX && x > 0.5f) {
              id(last_flow_time) = millis();
              if (!id(flow_confirmed)) {
                uint32_t elapsed = millis() - id(pump_start_time);
                if (elapsed > (\${flow_confirm_seconds} * 1000U)) {
                  id(flow_confirmed) = true;
                  ESP_LOGI("safety", "Flow confirmed on sensor %d after %us", SENSOR_IDX, elapsed / 1000);
                }
              }
            }
          }`);

  const totalBlocks = m.flow_sensors.map((f) => `\
  - platform: integration
    sensor: ${f.id}
    name: "${f.name.replace("Water Flow", "Total Usage").replace("Flow", "Total")}"
    id: ${f.id}_total
    unit_of_measurement: "L"
    time_unit: min
    icon: "mdi:counter"
    state_class: total_increasing`);

  const tankBlocks = m.tanks.map((t, i) => `\
  - platform: adc
    pin: \${pin_${t.id}_level}
    id: ${t.id}_level
    name: "${t.name} Level"
    unit_of_measurement: "%"
    icon: "mdi:storage-tank"
    update_interval: \${update_interval}
    attenuation: 12db
    filters:
      - lambda: |-
          id(${t.id}_raw_voltage).publish_state(x);
          float v_empty = id(${t.id}_cal_empty).state;
          float v_full  = id(${t.id}_cal_full).state;
          if (v_full <= v_empty) return 0.0f;
          float pct = (x - v_empty) / (v_full - v_empty) * 100.0f;
          return clamp(pct, 0.0f, 100.0f);
      - lambda: |-
          const int TANK_IDX = ${i};
          if (id(active_route) >= 0 && id(active_route) < NUM_ROUTES) {
            int s = id(system_state);
            if (s >= 1 && s <= 3) {
              const Route& r = ROUTES[id(active_route)];
              if (r.source_tank == TANK_IDX || r.dest_tank == TANK_IDX) return {};
            }
          }
          return x;

  - platform: template
    id: ${t.id}_raw_voltage
    name: "${t.name} Raw Voltage"
    unit_of_measurement: "V"
    icon: "mdi:flash-triangle"
    accuracy_decimals: 3
    entity_category: diagnostic`);

  const calBlocks = m.tanks.map((t) => `\
  - platform: template
    name: "${t.name} Cal Empty (V)"
    id: ${t.id}_cal_empty
    icon: "mdi:tune-vertical"
    min_value: 0.0
    max_value: 3.3
    step: 0.001
    initial_value: 0.0
    optimistic: true
    restore_value: true
    entity_category: config

  - platform: template
    name: "${t.name} Cal Full (V)"
    id: ${t.id}_cal_full
    icon: "mdi:tune-vertical"
    min_value: 0.0
    max_value: 3.3
    step: 0.001
    initial_value: 3.3
    optimistic: true
    restore_value: true
    entity_category: config`);

  return `\
# =============================================================================
# Pump Controller — Sensor & Measurement Layer
# =============================================================================
# AUTO-GENERATED from system manifest. Do not edit by hand.
#
# Components:
#   - ${m.flow_sensors.length}x flow sensors (pulse counter -> L/min + totalization)
#   - ${m.tanks.length}x tank level sensors (ADC -> 0-100%)
#   - State exposure (system_state_text, fault_text for HA)
#
# Tank level readings are suppressed during pump operation (states 1-3)
# for any tank involved in the active route (source or destination).
# =============================================================================

sensor:
  # --- Flow sensors ----------------------------------------------------------
${flowBlocks.join("\n\n")}

  # --- Flow totalization -----------------------------------------------------
${totalBlocks.join("\n\n")}

  # --- Tank levels -----------------------------------------------------------
${tankBlocks.join("\n\n")}

# --- Calibration numbers (adjustable from HA) --------------------------------

number:
${calBlocks.join("\n\n")}

# --- State exposure to HA ----------------------------------------------------

text_sensor:
  - platform: template
    id: system_state_text
    name: "Pump System State"
    icon: "mdi:state-machine"
    update_interval: 2s
    lambda: |-
      const char* states[] = {"IDLE", "PREPARING", "RUNNING", "STOPPING", "FAULT"};
      int s = id(system_state);
      return std::string((s >= 0 && s <= 4) ? states[s] : "UNKNOWN");

  - platform: template
    id: fault_text
    name: "Pump Fault"
    icon: "mdi:alert-circle"
    update_interval: 2s
    lambda: |-
      int f = id(fault_code);
      if (f == 0) return std::string("None");
      const char* faults[] = {
        "None",
        "No flow detected",
        "Max runtime exceeded",
        "HA connection lost"
      };
      std::string msg = (f >= 0 && f <= 3) ? faults[f] : "Unknown";
      if (id(active_route) >= 0 && id(active_route) < NUM_ROUTES) {
        msg += " (";
        msg += ROUTES[id(active_route)].name;
        msg += ")";
      }
      return msg;

  - platform: template
    id: last_stop_reason_text
    name: "Pump Last Stop Reason"
    icon: "mdi:alert-octagon-outline"
    update_interval: 2s
    lambda: |-
      const char* reasons[] = {
        "None",
        "Manual stop",
        "Tank full",
        "No flow detected",
        "Max runtime exceeded",
        "HA connection lost"
      };
      int r = id(stop_reason);
      return std::string((r >= 0 && r <= 5) ? reasons[r] : "Unknown");
`;
}
