import type { Manifest } from "../schema.js";
import { nodesWithFlag } from "../schema.js";
import { levelSensorLevelId, joinYamlItems, SYSTEM_ENTITY_NAMES, routeEntityNames } from '@far-mon/core';
import type { CollectedCodegen } from "./collect.js";

const SYS = SYSTEM_ENTITY_NAMES;

export function generateSensors(m: Manifest, collected: CollectedCodegen): string {
  // Level sensor entities (standalone, decoupled from tanks)
  const levelSensors = nodesWithFlag(m.nodes, 'isLevelSensor');

  // Route max-runtime numbers — adjustable from HA, persisted across reboots
  const runtimeBlocks = m.routes.map((r, i) => `\
- platform: template
  name: "${routeEntityNames(r).maxRuntime.name}"
  id: route_${i}_max_runtime
  icon: "mdi:timer-outline"
  unit_of_measurement: "s"
  min_value: 60
  max_value: 7200
  step: 60
  initial_value: ${r.max_runtime_seconds}
  optimistic: true
  restore_value: true
  entity_category: config`);

  // Global safety timing — adjustable from HA
  const safetyBlocks = [
    { name: SYS.flowWatchdogMs.name, id: 'flow_watchdog_ms', icon: 'mdi:waves-arrow-up', min: 5000, max: 120000, step: 1000, initial: m.timing.flow_watchdog * 1000 },
    { name: SYS.flowConfirmMs.name,  id: 'flow_confirm_ms',  icon: 'mdi:check-decagram-outline', min: 3000, max: 60000, step: 1000, initial: m.timing.flow_confirm * 1000 },
    { name: SYS.flowThreshold.name,  id: 'flow_threshold_l_min', icon: 'mdi:waves', min: 0.1, max: 20, step: 0.1, initial: m.timing.flow_threshold },
    { name: SYS.apiWatchdogMs.name,  id: 'api_watchdog_ms',  icon: 'mdi:api', min: 30000, max: 600000, step: 10000, initial: m.timing.api_watchdog * 1000 },
  ].map((p) => `\
- platform: template
  name: "${p.name}"
  id: ${p.id}
  icon: "${p.icon}"
  min_value: ${p.min}
  max_value: ${p.max}
  step: ${p.step}
  initial_value: ${p.initial}
  optimistic: true
  restore_value: true
  entity_category: config`);

  const numberBlocks = [...runtimeBlocks, ...safetyBlocks, ...(collected.sections['number'] ?? [])];
  const binarySensorBlocks = collected.sections['binary_sensor'] ?? [];

  return `\
# =============================================================================
# MajiFlow — Sensor & Measurement Layer
# =============================================================================
# AUTO-GENERATED from system manifest. Do not edit by hand.
#
# Components derived from entity codegen registrations.
# Tank level readings are suppressed during route operation (states 1-3)
# for any tank involved in the active route (source or destination).
# =============================================================================

sensor:
${joinYamlItems(collected.sensors)}${levelSensors.length >= 2 ? `
  # --- Combined level (auto-derived from ${levelSensors.length} level sensors) ------

  - platform: template
    id: combined_tank_level
    name: "${SYS.combinedTankLevel.name}"
    unit_of_measurement: "%"
    icon: "mdi:water-percent"
    accuracy_decimals: 0
    update_interval: 5s
    lambda: |-
      float sum = 0; int count = 0;
${levelSensors.map(t => `\
      { float v = id(${levelSensorLevelId({ id: String(t['id']) })}).state; if (!std::isnan(v)) { sum += v; count++; } }`).join("\n")}
      return count > 0 ? sum / (float)count : 0.0f;` : ""}

${numberBlocks.length > 0 ? `# --- Adjustable numbers (persisted, editable from HA) -------------------------

number:
${joinYamlItems(numberBlocks)}` : ""}

# --- State exposure to HA ----------------------------------------------------

text_sensor:
  - platform: template
    id: system_state_text
    name: "${SYS.systemState.name}"
    icon: "mdi:state-machine"
    update_interval: 2s
    lambda: |-
      const char* states[] = {"IDLE", "PREPARING", "RUNNING", "STOPPING", "FAULT"};
      int s = id(system_state);
      return std::string((s >= 0 && s <= 4) ? states[s] : "UNKNOWN");

  - platform: template
    id: fault_text
    name: "${SYS.systemFault.name}"
    icon: "mdi:alert-circle"
    update_interval: 2s
    lambda: |-
      const char* faults[] = {"","No flow detected","Max runtime exceeded","HA connection lost"};
      std::string msg;
      for (int s = 0; s < MAX_CONCURRENT_ROUTES; s++) {
        if (slots[s].fault_code == 0) continue;
        if (msg.length() > 0) msg += " | ";
        int f = slots[s].fault_code;
        msg += (f >= 1 && f <= 3) ? faults[f] : "Unknown";
        if (slots[s].route_id >= 0 && slots[s].route_id < NUM_ROUTES) {
          msg += " ("; msg += ROUTES[slots[s].route_id].name; msg += ")";
        }
      }
      return msg.empty() ? std::string("None") : msg;

  - platform: template
    id: last_stop_reason_text
    name: "${SYS.lastStopReason.name}"
    icon: "mdi:alert-octagon-outline"
    update_interval: 2s
    lambda: |-
      const char* reasons[] = {
        "None",
        "Manual stop",
        "Tank full",
        "No flow detected",
        "Max runtime exceeded",
        "HA connection lost",
        "Source tank low"
      };
      int r = id(stop_reason);
      return std::string((r >= 0 && r <= 6) ? reasons[r] : "Unknown");

  - platform: template
    id: active_routes_text
    name: "${SYS.activeRoutes.name}"
    icon: "mdi:routes"
    update_interval: 2s
    lambda: |-
      const char* st[] = {"","PREP","RUN","STOP"};
      std::string s;
      for (int i = 0; i < MAX_CONCURRENT_ROUTES; i++) {
        if (slots[i].state < 1 || slots[i].state > 3 || slots[i].route_id < 0) continue;
        if (s.length() > 0) s += " | ";
        s += st[slots[i].state]; s += ":"; s += ROUTES[slots[i].route_id].name;
      }
      return s.empty() ? std::string("Idle") : s;

  - platform: template
    id: route_queue_text
    name: "${SYS.routeQueue.name}"
    icon: "mdi:tray-full"
    update_interval: 2s
    lambda: |-
      if (queue_count == 0) return std::string("Empty");
      std::string s;
      for (int i = 0; i < queue_count; i++) {
        int rid = queue_peek(i);
        if (i > 0) s += " > ";
        if (rid >= 0 && rid < NUM_ROUTES) s += ROUTES[rid].name;
      }
      return s;

  # --- Per-route status sensors ------------------------------------------------
${m.routes.map((r, i) => `\
  - platform: template
    id: route_${i}_status
    name: "${routeEntityNames(r).status.name}"
    icon: "mdi:routes"
    update_interval: 2s
    lambda: |-
      int s = find_slot_by_route(${i});
      if (s < 0) return std::string("Idle");
      const char* st[] = {"Idle","Preparing","Running","Stopping","Fault"};
      return std::string((slots[s].state >= 0 && slots[s].state <= 4) ? st[slots[s].state] : "Unknown");`).join("\n\n")}
${collected.globals.length > 0 ? `
# --- Sensor fault detection --------------------------------------------------

globals:
${joinYamlItems(collected.globals)}` : ""}
${binarySensorBlocks.length > 0 || levelSensors.length >= 2 ? `
binary_sensor:
${joinYamlItems(binarySensorBlocks)}${levelSensors.length >= 2 ? `
  - platform: template
    id: water_critical
    name: "${SYS.waterCritical.name}"
    icon: "mdi:water-alert"
    device_class: problem
    lambda: |-
      float c = id(combined_tank_level).state;
      return !std::isnan(c) && c < 35.0f;` : ""}` : ""}
${Object.entries(collected.sections)
    .filter(([k]) => !['number', 'binary_sensor', 'cover'].includes(k))
    .map(([section, blocks]) => `\n${section}:\n${joinYamlItems(blocks)}`)
    .join("\n")}
`;
}
