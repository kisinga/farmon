import type { TestProbe } from '../probe.js';
import { resultId, detailId, sensorHeaderPins } from '../probe.js';

export const sensorHeadersProbe: TestProbe = {
  id: 'sensor_headers',
  label: 'Sensor Headers',

  appliesTo: (board) => sensorHeaderPins(board).length > 0,

  constants: (board) => {
    const pins = sensorHeaderPins(board);
    const gpioNums = pins.map(p => p.gpio.replace('GPIO', ''));
    return [
      `static const int NUM_SENSOR_PINS = ${pins.length};`,
      `static const int SENSOR_GPIO[] = { ${gpioNums.join(', ')} };`,
    ].join('\n  ');
  },

  state: () => '',
  helpers: () => '',

  tick: () => {
    const rid = resultId({ id: 'sensor_headers' });
    const did = detailId({ id: 'sensor_headers' });
    return `
    if (sub_step == 0) {
      ESP_LOGI("selftest", "=== Sensor Headers (%d pins) ===", NUM_SENSOR_PINS);
      char detail[64] = "";
      int dlen = 0;
      bool all_high = true;
      for (int i = 0; i < NUM_SENSOR_PINS; i++) {
        bool val = digitalRead(SENSOR_GPIO[i]);
        if (!val) all_high = false;
        dlen += snprintf(detail + dlen, sizeof(detail) - dlen,
          "GPIO%d:%s ", SENSOR_GPIO[i], val ? "HIGH" : "LOW");
      }
      record("Sensor Headers", all_high, detail);
      id(${rid}).publish_state(all_high);
      id(${did}).publish_state(detail);
      next_phase();
    }`;
  },

  yaml: () => ({}),
};
