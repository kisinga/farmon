import type { TestProbe } from '../probe.js';
import { resultId, detailId } from '../probe.js';

export const batteryAdcProbe: TestProbe = {
  id: 'battery_adc',
  label: 'Battery ADC',

  appliesTo: (board) => !!board.peripherals.battery,

  constants: () => '',
  state: () => '',
  helpers: () => '',

  tick: () => {
    const rid = resultId({ id: 'battery_adc' });
    const did = detailId({ id: 'battery_adc' });
    return `
    if (sub_step == 0) {
      ESP_LOGI("selftest", "=== Battery ADC ===");
      id(bat_adc_enable).turn_on();
      step_timer = millis();
      sub_step = 1;
    } else if (sub_step == 1 && millis() - step_timer >= 50) {
      id(battery_voltage).update();
      step_timer = millis();
      sub_step = 2;
    } else if (sub_step == 2 && millis() - step_timer >= 100) {
      id(bat_adc_enable).turn_off();
      float v = id(battery_voltage).state;
      bool ok = !std::isnan(v);
      char detail[64];
      snprintf(detail, sizeof(detail), "%.2fV %s", v, ok ? "(ADC functional)" : "(NaN)");
      record("Battery ADC", ok, detail);
      id(${rid}).publish_state(ok);
      id(${did}).publish_state(detail);
      next_phase();
    }`;
  },

  yaml: () => ({}),
};
