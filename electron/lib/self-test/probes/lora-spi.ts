import type { TestProbe } from '../probe.js';
import { resultId, detailId } from '../probe.js';

export const loraSpiProbe: TestProbe = {
  id: 'lora_spi',
  label: 'LoRa SPI',

  appliesTo: (board) => !!board.peripherals.lora,

  constants: (board) => {
    const lora = board.peripherals.lora!;
    const rstPin = lora.control_pins?.rst ?? '';
    const busyPin = lora.control_pins?.busy ?? '';
    return [
      `static const int LORA_RST_PIN = ${rstPin.replace('GPIO', '')};`,
      `static const int LORA_BUSY_PIN = ${busyPin.replace('GPIO', '')};`,
    ].join('\n  ');
  },

  state: () => '',
  helpers: () => '',

  tick: (board) => {
    const lora = board.peripherals.lora!;
    const rid = resultId({ id: 'lora_spi' });
    const did = detailId({ id: 'lora_spi' });
    return `
    if (sub_step == 0) {
      ESP_LOGI("selftest", "=== LoRa SPI (${lora.chip}) ===");
      // Reset the ${lora.chip} and verify BUSY pin response
      pinMode(LORA_RST_PIN, OUTPUT);
      pinMode(LORA_BUSY_PIN, INPUT);
      digitalWrite(LORA_RST_PIN, LOW);
      step_timer = millis();
      sub_step = 1;
    } else if (sub_step == 1 && millis() - step_timer >= 2) {
      // Release reset
      digitalWrite(LORA_RST_PIN, HIGH);
      step_timer = millis();
      sub_step = 2;
    } else if (sub_step == 2) {
      // Wait for BUSY to go LOW (chip ready) — timeout 50ms
      bool busy = digitalRead(LORA_BUSY_PIN);
      if (!busy) {
        char detail[64];
        snprintf(detail, sizeof(detail), "${lora.chip} BUSY=LOW after reset (chip alive)");
        record("LoRa SPI", true, detail);
        id(${rid}).publish_state(true);
        id(${did}).publish_state(detail);
        next_phase();
      } else if (millis() - step_timer >= 50) {
        char detail[64];
        snprintf(detail, sizeof(detail), "${lora.chip} BUSY stuck HIGH after reset");
        record("LoRa SPI", false, detail);
        id(${rid}).publish_state(false);
        id(${did}).publish_state(detail);
        next_phase();
      }
    }`;
  },

  yaml: () => ({}),
};
