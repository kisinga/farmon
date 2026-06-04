import type { TestProbe } from '../probe';
import { resultId, detailId } from '../probe';

export const oledDisplayProbe: TestProbe = {
  id: 'oled_display',
  label: 'OLED Display',

  appliesTo: (board) => !!board.peripherals.oled,

  constants: () => '',
  state: () => '',
  helpers: () => '',

  tick: (board) => {
    const oled = board.peripherals.oled!;
    const rid = resultId({ id: 'oled_display' });
    const did = detailId({ id: 'oled_display' });
    // Verify OLED via I2C address probe — reliable, no private API
    const addr = typeof oled.address === 'number' ? oled.address : parseInt(String(oled.address), 16);
    return `
    if (sub_step == 0) {
      ESP_LOGI("selftest", "=== OLED Display Test ===");
      // Probe I2C address to verify chip responds
      bool ok = i2c_probe(0x${addr.toString(16).padStart(2, '0')});
      // Also trigger a display update via ESPHome component
      if (ok) {
        id(oled).show_page(id(page_splash));
        id(oled).update();
      }
      step_timer = millis();
      sub_step = 1;
      char detail[64];
      if (ok) {
        snprintf(detail, sizeof(detail), "I2C 0x${addr.toString(16).padStart(2, '0')} ACK, display updated");
      } else {
        snprintf(detail, sizeof(detail), "I2C 0x${addr.toString(16).padStart(2, '0')} NACK");
      }
      record("OLED Display", ok, detail);
      id(${rid}).publish_state(ok);
      id(${did}).publish_state(detail);
    } else if (sub_step == 1 && millis() - step_timer >= 2000) {
      next_phase();
    }`;
  },

  yaml: () => ({}),
};
