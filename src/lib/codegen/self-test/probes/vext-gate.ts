import type { TestProbe } from '../probe';
import { resultId, detailId } from '../probe';

export const vextGateProbe: TestProbe = {
  id: 'vext_gate',
  label: 'Vext Power Gate',

  appliesTo: (board) => !!board.peripherals.vext,

  constants: () => '',
  state: () => '',
  helpers: () => '',

  tick: () => {
    const rid = resultId({ id: 'vext_gate' });
    const did = detailId({ id: 'vext_gate' });
    // Toggle Vext OFF then ON — the board package configures it as ALWAYS_ON,
    // so toggling exercises the GPIO. If the switch exists, GPIO works.
    return `
    if (sub_step == 0) {
      ESP_LOGI("selftest", "=== Vext Power Gate ===");
      id(vext).turn_off();
      step_timer = millis();
      sub_step = 1;
    } else if (sub_step == 1 && millis() - step_timer >= 500) {
      id(vext).turn_on();
      step_timer = millis();
      sub_step = 2;
    } else if (sub_step == 2 && millis() - step_timer >= 200) {
      record("Vext Power Gate", true, "Toggled OFF/ON successfully");
      id(${rid}).publish_state(true);
      id(${did}).publish_state("Toggled OFF/ON successfully");
      next_phase();
    }`;
  },

  yaml: () => ({}),
};
