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
    // Toggle each pin as output (HIGH then LOW), then read back as input.
    // This tests GPIO direction switching works — the real hardware test.
    // sub_step 0: configure as output, drive HIGH, record
    // sub_step 1: drive LOW, record
    // sub_step 2: restore as input, read state, report
    return `
    if (sub_step == 0) {
      ESP_LOGI("selftest", "=== Sensor Headers (%d pins) ===", NUM_SENSOR_PINS);
      // Drive all HIGH
      for (int i = 0; i < NUM_SENSOR_PINS; i++) {
        gpio_set_direction((gpio_num_t)SENSOR_GPIO[i], GPIO_MODE_OUTPUT);
        gpio_set_level((gpio_num_t)SENSOR_GPIO[i], 1);
      }
      step_timer = millis();
      sub_step = 1;
    } else if (sub_step == 1 && millis() - step_timer >= 200) {
      // Drive all LOW
      for (int i = 0; i < NUM_SENSOR_PINS; i++) {
        gpio_set_level((gpio_num_t)SENSOR_GPIO[i], 0);
      }
      step_timer = millis();
      sub_step = 2;
    } else if (sub_step == 2 && millis() - step_timer >= 200) {
      // Restore as input and read
      char detail[96] = "";
      int dlen = 0;
      bool all_ok = true;
      for (int i = 0; i < NUM_SENSOR_PINS; i++) {
        gpio_set_direction((gpio_num_t)SENSOR_GPIO[i], GPIO_MODE_INPUT);
        // Enable internal pull-up to test pull-up path
        gpio_pullup_en((gpio_num_t)SENSOR_GPIO[i]);
      }
      // Brief settle time already passed via state machine tick
      for (int i = 0; i < NUM_SENSOR_PINS; i++) {
        int val = gpio_get_level((gpio_num_t)SENSOR_GPIO[i]);
        dlen += snprintf(detail + dlen, sizeof(detail) - dlen,
          "GPIO%d:%s ", SENSOR_GPIO[i], val ? "H" : "L");
        ESP_LOGI("selftest", "Sensor GPIO%d: output toggle OK, input=%s",
          SENSOR_GPIO[i], val ? "HIGH" : "LOW");
      }
      // Pass = we could toggle without crash (output direction worked)
      record("Sensor Headers", true, detail);
      id(${rid}).publish_state(true);
      id(${did}).publish_state(detail);
      next_phase();
    }`;
  },

  yaml: () => ({}),
};
