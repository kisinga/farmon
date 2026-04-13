import type { TestProbe } from '../probe.js';
import { resultId, detailId } from '../probe.js';

export const ledBlinkProbe: TestProbe = {
  id: 'led_blink',
  label: 'LED Blink',

  appliesTo: (board) => !!board.peripherals.led,

  constants: () => '',
  state: () => '',
  helpers: () => '',

  tick: () => {
    const rid = resultId({ id: 'led_blink' });
    const did = detailId({ id: 'led_blink' });
    return `
    if (sub_step == 0) {
      ESP_LOGI("selftest", "=== LED Blink ===");
      step_timer = millis();
    }
    if (sub_step < 10) {
      if (millis() - step_timer >= 200) {
        if (sub_step % 2 == 0) {
          id(led_output).turn_on();
        } else {
          id(led_output).turn_off();
        }
        step_timer = millis();
        sub_step++;
      }
    } else {
      id(led_output).turn_off();
      record("LED Blink", true, "5 blink cycles completed (visual)");
      id(${rid}).publish_state(true);
      id(${did}).publish_state("5 blink cycles completed (visual)");
      next_phase();
    }`;
  },

  yaml: () => ({}),
};
