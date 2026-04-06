import type { Manifest } from "../schema.js";
import { nodesByKind } from "../schema.js";
import { NODE_REGISTRY } from "../../../shared/entity-registry.js";

export function generateSensors(m: Manifest): string {
  // Collect sensor blocks from all entities that provide them
  const sensorBlocks: string[] = [];
  const globalBlocks: string[] = [];

  for (const node of m.nodes) {
    const desc = NODE_REGISTRY.get(node.kind);
    if (!desc?.codegen) continue;
    const idx = nodesByKind(m.nodes, node.kind).indexOf(node);

    if (desc.codegen.sensors) {
      const block = desc.codegen.sensors(node, idx);
      if (block) sensorBlocks.push(block);
    }
    if (desc.codegen.globals) {
      const block = desc.codegen.globals(node);
      if (block) globalBlocks.push(block);
    }
  }

  // Tank calibration numbers — specific to tanks with level sensors
  const tanksWithLevel = nodesByKind(m.nodes, 'tank').filter(t => t['level_pin']);
  const calBlocks = tanksWithLevel.map((t) => `\
  - platform: template
    name: "${t['name']} Cal Empty (V)"
    id: ${t['id']}_cal_empty
    icon: "mdi:tune-vertical"
    min_value: 0.0
    max_value: 3.3
    step: 0.001
    initial_value: 0.0
    optimistic: true
    restore_value: true
    entity_category: config

  - platform: template
    name: "${t['name']} Cal Full (V)"
    id: ${t['id']}_cal_full
    icon: "mdi:tune-vertical"
    min_value: 0.0
    max_value: 3.3
    step: 0.001
    initial_value: 3.3
    optimistic: true
    restore_value: true
    entity_category: config`);

  // Flow sensor fault detection binary sensors
  const flowSensors = nodesByKind(m.nodes, 'flow_sensor');
  const faultSensors = flowSensors.map((f) => `\
  - platform: template
    id: ${f['id']}_sensor_fault
    name: "${f['name']} Sensor Fault"
    icon: "mdi:alert-decagram"
    device_class: problem
    entity_category: diagnostic
    lambda: return id(${f['id']}_fault_count) >= 3;`);

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
${sensorBlocks.join("\n\n")}

${calBlocks.length > 0 ? `# --- Calibration numbers (adjustable from HA) --------------------------------

number:
${calBlocks.join("\n\n")}` : ""}

# --- State exposure to HA ----------------------------------------------------

text_sensor:
  - platform: template
    id: system_state_text
    name: "System State"
    icon: "mdi:state-machine"
    update_interval: 2s
    lambda: |-
      const char* states[] = {"IDLE", "PREPARING", "RUNNING", "STOPPING", "FAULT"};
      int s = id(system_state);
      return std::string((s >= 0 && s <= 4) ? states[s] : "UNKNOWN");

  - platform: template
    id: fault_text
    name: "System Fault"
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
    name: "Last Stop Reason"
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
${globalBlocks.length > 0 ? `
# --- Sensor fault detection --------------------------------------------------

globals:
${globalBlocks.join("\n")}` : ""}
${faultSensors.length > 0 ? `
binary_sensor:
${faultSensors.join("\n\n")}` : ""}
`;
}
