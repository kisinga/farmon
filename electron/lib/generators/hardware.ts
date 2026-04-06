import type { Manifest } from "../schema.js";

export function generateHardware(m: Manifest): string {
  const relayBlock = m.pump ? `\
switch:
  # --- Pump relay ------------------------------------------------------------
  - platform: gpio
    pin:
      number: \${pin_pump_relay}
      inverted: true
    id: pump_relay
    name: "Pump Relay"
    icon: "mdi:water-pump"
    internal: true
    restore_mode: ALWAYS_OFF
    on_turn_on:
      - if:
          condition:
            lambda: 'return id(system_state) != 2;'
          then:
            - switch.turn_off: pump_relay
            - logger.log: {level: WARN, format: "BLOCKED: pump only runs in RUNNING state"}
` : "";

  const valveBlocks = m.valves.map((v) => `\
  # --- ${v.name} ---
  - platform: gpio
    pin:
      number: \${pin_${v.id}_o}
      inverted: true
    id: ${v.id}_open_pin
    internal: true
    restore_mode: ALWAYS_OFF
    interlock: [${v.id}_open_pin, ${v.id}_close_pin]
    interlock_wait_time: 100ms
  - platform: gpio
    pin:
      number: \${pin_${v.id}_c}
      inverted: true
    id: ${v.id}_close_pin
    internal: true
    restore_mode: ALWAYS_OFF
    interlock: [${v.id}_open_pin, ${v.id}_close_pin]
    interlock_wait_time: 100ms`);

  const coverBlocks = m.valves.map((v) => `\
  - platform: time_based
    id: ${v.id}
    name: "${v.name}"

    open_action:  [{switch.turn_on: ${v.id}_open_pin}]
    close_action: [{switch.turn_on: ${v.id}_close_pin}]
    stop_action:  [{switch.turn_off: ${v.id}_open_pin}, {switch.turn_off: ${v.id}_close_pin}]
    open_duration: \${valve_travel_time}
    close_duration: \${valve_travel_time}`);

  return `\
# =============================================================================
# MajiFlow — Hardware Layer
# =============================================================================
# AUTO-GENERATED from system manifest. Do not edit by hand.
# Regenerate: npx tsx tools/codegen/src/main.ts generate system.yaml
#
# Physical actuators only. No state logic, no sensor readings.
#
# Components:
${m.pump ? "#   - 1x pump relay (guarded: only energizes in RUNNING state)\n" : ""}\
#   - ${m.valves.length}x motorized ball valves (2-pin each, hardware interlocked)
# =============================================================================

${relayBlock}
${valveBlocks.join("\n\n")}

# --- Ball valves (covers) ----------------------------------------------------

cover:
${coverBlocks.join("\n\n")}
`;
}
