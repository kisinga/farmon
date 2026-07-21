import type { Manifest } from '@core';
import type { BoardDef } from '@core';
import { boardInputPins, resolveButtonAssignments } from '@core';
import { joinYamlItems, yamlString } from '@core';
import { resolvePinYaml } from '../../codegen-ids';

/**
 * Local panel buttons — the board's optocoupled digital inputs (KC868-A16
 * IN1–IN16 on the pcf8574_in_* expanders) as gpio binary_sensors.
 *
 * Route buttons are TOGGLES: the on_press lambda reads the control engine's
 * slot table (same accessor the OLED and the route-status sensors use) —
 * route active (PREPARING/RUNNING/STOPPING) → stop_route, route in FAULT →
 * reset_faults (press once to clear, again to start), else start_route.
 * Stop All presses the control layer's btn_stop_all template button.
 *
 * Every sensor carries a 50ms delayed_on_off debounce: the PCF8574 expanders
 * are polled once per loop, so raw mechanical bounce would double-fire the
 * toggle (start, then an instant stop a few ms later).
 *
 * Mapping: the controller's explicit `local.buttons` when set, otherwise the
 * default auto-assign (Stop All on IN1, routes in order on IN2..IN(n+1)) —
 * resolved by resolveButtonAssignments, the same rule the site manual and
 * the editor show. Emits nothing (null) on boards without input expanders;
 * the device YAML skips the package include on the same predicate.
 *
 * ELECTRICAL ASSUMPTION (confirm on the bench): the KC868 inputs assert by
 * pulling to GND through the optocoupler (board doc: "pull to GND to
 * assert"), so the PCF8574 reads LOW when the button is pressed — the pin is
 * emitted `inverted: true` so on_press fires on the press edge.
 */

// Copy the engine's derived status into the globals the OLED + snapshot read
// (mirrors PUBLISH_STATUS in control.ts, at this lambda's body indent).
const PUBLISH_STATUS =
  '        id(system_state) = id(control).system_state();\n' +
  '        id(active_slot) = id(control).active_slot();\n' +
  '        id(stop_reason) = id(control).stop_reason();';

export function generateLocalInputs(m: Manifest, board: BoardDef): string | null {
  const inputPins = boardInputPins(board);
  if (inputPins.length === 0) return null;

  const assignments = resolveButtonAssignments(m.routes, inputPins, m.device.local);
  if (assignments.length === 0) return null;

  const blocks = assignments.map((a) => {
    // Entity names must not contain '/' (ESPHome URL separator — warns now, hard
    // error in 2026.7.0). Hyphenate both our own prefix and any '/' in route names.
    const label = a.action === 'stop_all' ? 'Stop All' : `Start-stop ${a.routeName.replaceAll('/', '-')}`;
    const onPress = a.action === 'stop_all'
      ? `  on_press:
    - button.press: btn_stop_all`
      : `  on_press:
    - lambda: |-
        // Toggle: stop when this route holds a slot (PREPARING/RUNNING — a press
        // during STOPPING is a refused no-op), start otherwise.
        auto &cs = id(control).state();
        int s = maji_ctl::find_slot_by_route(cs, ${a.routeIndex});
        if (s >= 0 && cs.slots[s].state >= maji_ctl::ST_PREPARING && cs.slots[s].state <= maji_ctl::ST_STOPPING) {
          id(control).stop_route(${a.routeIndex}, "", maji_ctl::ORIGIN_MANUAL, "");
        } else if (s >= 0 && cs.slots[s].state == maji_ctl::ST_FAULT) {
          // FAULT is neither startable nor stoppable — start_route would be
          // refused, leaving the button dead exactly when the operator needs
          // it. Two-press semantics: press once to clear the fault, again to
          // start the route.
          id(control).reset_faults();
        } else {
          // Physical button = a local manual action with no remote user id.
          id(control).start_route(${a.routeIndex}, "", maji_ctl::StopSpec{}, maji_ctl::ORIGIN_MANUAL, "");
        }
${PUBLISH_STATUS}`;
    return `\
- platform: gpio
  id: panel_btn_${a.input.toLowerCase()}
  name: ${yamlString(`Button ${a.input} — ${label}`)}
  pin:
    ${resolvePinYaml(a.input, board, { mode: 'INPUT', inverted: true })}
  filters:
    - delayed_on_off: 50ms
${onPress}`;
  });

  return `# =============================================================================
# MajiFlow — Local Panel Buttons
# =============================================================================
# AUTO-GENERATED from system manifest. Do not edit by hand.
#
# Physical buttons on the board's optocoupled inputs. Route buttons toggle
# (press = start, press again = stop); Stop All presses btn_stop_all.
# Mapping: ${m.device.local?.buttons?.length ? 'explicit local.buttons' : 'default auto-assign (Stop All on the first input, routes in order after it)'}.
# =============================================================================

binary_sensor:
${joinYamlItems(blocks)}
`;
}
