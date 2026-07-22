import type { Manifest } from '@core';
import { SYSTEM_ENTITY_NAMES, routeEntityNames } from '@core';

const SYS = SYSTEM_ENTITY_NAMES;

// Copy the engine's derived status into the globals the OLED + snapshot read.
const PUBLISH_STATUS =
  '          id(system_state) = id(control).system_state();\n' +
  '          id(active_slot) = id(control).active_slot();\n' +
  '          id(stop_reason) = id(control).stop_reason();';

/**
 * Control layer YAML. The route state machine, watchdog, and pump management now live
 * in the maji_control external component (firmware/components/maji_control); this file
 * is the thin glue: the status globals + safety switch, the operator buttons (which
 * call id(control) command methods), and the 1s/2s interval ticks that drive the engine.
 * The route table + entity bindings are emitted separately as the maji_control: config.
 */
export function generateControl(m: Manifest): string {
  const routeButtons = m.routes
    .map((r, i) => `\
  - platform: template
    name: "${routeEntityNames(r).start.name}"
    id: route_${i}_start
    icon: "mdi:play-circle"
    on_press:
      - lambda: |-
          // Physical button = a local manual action with no remote user id.
          id(control).start_route(${i}, "", maji_ctl::StopSpec{}, maji_ctl::ORIGIN_MANUAL, "");
${PUBLISH_STATUS}
  - platform: template
    name: "${routeEntityNames(r).stop.name}"
    id: route_${i}_stop
    icon: "mdi:stop-circle"
    on_press:
      - lambda: |-
          id(control).stop_route(${i}, "", maji_ctl::ORIGIN_MANUAL, "");
${PUBLISH_STATUS}`)
    .join('\n');

  return `# =============================================================================
# MajiFlow — Control Layer (glue)
# =============================================================================
# The route state machine + safety watchdog + pump management run in the
# maji_control external component. This file wires it: status globals, the safety
# override switch, operator buttons (-> id(control) commands), and the 1s/2s ticks.
#
# Slot states: IDLE(0) -> PREPARING(1) -> RUNNING(2) -> STOPPING(3) -> IDLE(0)
#                                  '------> FAULT(4) <------'
# =============================================================================

globals:
  - id: system_state
    type: int
    initial_value: "0"
    # 0=IDLE 1=PREPARING 2=RUNNING 3=STOPPING 4=FAULT (highest across slots)
  - id: stop_reason
    type: int
    initial_value: "0"
  - id: active_slot
    type: int
    initial_value: "-1"

switch:
  - platform: template
    name: "${SYS.safetyOverride.name}"
    id: safety_override
    optimistic: true
    restore_mode: ALWAYS_OFF

button:
  - platform: template
    name: "${SYS.stopAll.name}"
    id: btn_stop_all
    icon: "mdi:stop-circle"
    on_press:
      - lambda: |-
          // Panel path (IN1 presses this button): MQTT / local-UI stop-alls call
          // stop_all directly with the envelope actor instead.
          id(control).stop_all(maji_ctl::ORIGIN_MANUAL, "panel");
${PUBLISH_STATUS}
          ESP_LOGI("ctrl", "Stop all requested");

  - platform: template
    name: "${SYS.resetFaults.name}"
    id: btn_reset_faults
    icon: "mdi:alert-circle-check"
    on_press:
      - lambda: |-
          id(control).reset_faults();
${PUBLISH_STATUS}
          ESP_LOGI("ctrl", "All faults cleared");

  - platform: template
    name: "${SYS.clearQueue.name}"
    id: btn_clear_queue
    icon: "mdi:tray-remove"
    on_press:
      - lambda: |-
          id(control).clear_queue();
          ESP_LOGI("ctrl", "Queue cleared");

${routeButtons}

interval:
  - interval: 1s
    then:
      - lambda: |-
          // Pass trusted wall-clock (unix secs, 0 if not yet synced) so the meter can
          // stamp run timestamps; the control logic ignores it.
          id(control).tick_1s(id(time_trusted) ? (uint32_t) id(sntp_time).now().timestamp : 0);
${PUBLISH_STATUS}
  - interval: 2s
    then:
      - lambda: |-
          id(control).tick_2s(id(time_trusted) ? (uint32_t) id(sntp_time).now().timestamp : 0);
`;
}
