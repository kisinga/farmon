import type { Manifest } from "../schema.js";
import { nodesWithFlag } from "../schema.js";
import { pressureSensorLevelId, joinYamlItems, SYSTEM_ENTITY_NAMES, routeEntityNames } from '@far-mon/core';
import type { CollectedCodegen } from "./collect.js";

const SYS = SYSTEM_ENTITY_NAMES;

export function generateSensors(m: Manifest, collected: CollectedCodegen): string {
  // Tanks with intrinsic level monitoring
  const tanksWithLevel = m.nodes.filter(n => n.kind === 'tank' && n['level_monitored']);

  // Route max-runtime numbers — adjustable from HA, persisted across reboots.
  // Surfaced in minutes (operator-facing); firmware multiplies by 60 to get
  // seconds when consuming. Manifest's max_runtime_seconds remains the seconds
  // source of truth; we round when seeding the entity.
  const runtimeBlocks = m.routes.map((r, i) => `\
- platform: template
  name: "${routeEntityNames(r).maxRuntime.name}"
  id: route_${i}_max_runtime
  icon: "mdi:timer-outline"
  unit_of_measurement: "min"
  min_value: 1
  max_value: 120
  step: 1
  initial_value: ${Math.max(1, Math.round(r.max_runtime_seconds / 60))}
  optimistic: true
  restore_value: true
  entity_category: config`);

  // Per-route safety thresholds — adjustable from HA, persisted across reboots.
  // Emitted only when the route's tank endpoint actually has a level reading;
  // otherwise the entity would be dead UI. A value of 0 means "skip this check".
  const safetyThresholdBlocks: string[] = [];
  m.routes.forEach((r, i) => {
    const names = routeEntityNames(r);
    if (r.source_has_level) {
      safetyThresholdBlocks.push(`\
- platform: template
  name: "${names.sourceMinLevel.name}"
  id: route_${i}_source_min_pct
  icon: "mdi:water-minus"
  unit_of_measurement: "%"
  min_value: 0
  max_value: 100
  step: 1
  initial_value: ${r.source_min_pct}
  optimistic: true
  restore_value: true
  entity_category: config`);
    }
    if (r.dest_has_level) {
      safetyThresholdBlocks.push(`\
- platform: template
  name: "${names.destMaxLevel.name}"
  id: route_${i}_dest_max_pct
  icon: "mdi:water-plus"
  unit_of_measurement: "%"
  min_value: 0
  max_value: 100
  step: 1
  initial_value: ${r.dest_max_pct}
  optimistic: true
  restore_value: true
  entity_category: config`);
    }
  });

  // Global safety timing — adjustable from HA. Values are operator-facing
  // units (seconds, L/min); firmware converts to its internal representation
  // (ms for time-based fields) at read time.
  const safetyBlocks = [
    { name: SYS.flowWatchdog.name,  id: 'flow_watchdog_s',     icon: 'mdi:waves-arrow-up',         unit: 's',     min: 5,   max: 120, step: 1,   initial: m.timing.flow_watchdog },
    { name: SYS.flowConfirm.name,   id: 'flow_confirm_s',      icon: 'mdi:check-decagram-outline', unit: 's',     min: 3,   max: 60,  step: 1,   initial: m.timing.flow_confirm },
    { name: SYS.flowThreshold.name, id: 'flow_threshold_l_min',icon: 'mdi:waves',                  unit: 'L/min', min: 0.1, max: 20,  step: 0.1, initial: m.timing.flow_threshold },
    { name: SYS.apiWatchdog.name,   id: 'api_watchdog_s',      icon: 'mdi:api',                    unit: 's',     min: 30,  max: 600, step: 10,  initial: m.timing.api_watchdog },
    { name: SYS.claimLease.name,    id: 'claim_lease_s',       icon: 'mdi:timer-refresh',          unit: 's',     min: 30,  max: 600, step: 10,  initial: 90 },
  ].map((p) => `\
- platform: template
  name: "${p.name}"
  id: ${p.id}
  icon: "${p.icon}"
  unit_of_measurement: "${p.unit}"
  min_value: ${p.min}
  max_value: ${p.max}
  step: ${p.step}
  initial_value: ${p.initial}
  optimistic: true
  restore_value: true
  entity_category: config`);

  const numberBlocks = [...runtimeBlocks, ...safetyThresholdBlocks, ...safetyBlocks, ...(collected.sections['number'] ?? [])];
  const binarySensorBlocks = [...(collected.sections['binary_sensor'] ?? [])];
  binarySensorBlocks.push(`\
- platform: template
  id: queue_full
  name: "${SYS.queueFull.name}"
  icon: "mdi:tray-full"
  lambda: |-
    return queue_count >= MAX_QUEUE_SIZE;`);
  binarySensorBlocks.push(`\
- platform: template
  id: api_partitioned
  name: "${SYS.apiPartitioned.name}"
  icon: "mdi:lan-disconnect"
  device_class: problem
  lambda: |-
    return is_api_partitioned(millis());`);

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
${joinYamlItems(collected.sensors)}${tanksWithLevel.length >= 2 ? `
  # --- Combined level (auto-derived from ${tanksWithLevel.length} tanks) ------

  - platform: template
    id: combined_tank_level
    name: "${SYS.combinedTankLevel.name}"
    unit_of_measurement: "%"
    icon: "mdi:water-percent"
    accuracy_decimals: 0
    update_interval: 5s
    lambda: |-
      float sum = 0; int count = 0;
${tanksWithLevel.map(t => `\
      { float v = id(${pressureSensorLevelId({ id: String(t['id']) })}).state; if (!std::isnan(v)) { sum += v; count++; } }`).join("\n")}
      return count > 0 ? sum / (float)count : 0.0f;` : ""}

  - platform: template
    id: queue_depth
    name: "${SYS.queueDepth.name}"
    icon: "mdi:counter"
    update_interval: 2s
    lambda: |-
      return (float)queue_count;

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
${binarySensorBlocks.length > 0 || tanksWithLevel.length >= 2 ? `
binary_sensor:
${joinYamlItems(binarySensorBlocks)}${tanksWithLevel.length >= 2 ? `
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
