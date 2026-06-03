import type { TestProbe } from '../probe';
import { resultId, detailId } from '../probe';

export const wifiScanProbe: TestProbe = {
  id: 'wifi_scan',
  label: 'WiFi Scan',

  appliesTo: (board) => !board.peripherals.ethernet,

  constants: () => '',
  state: () => '',
  helpers: () => '',

  tick: () => {
    const rid = resultId({ id: 'wifi_scan' });
    const did = detailId({ id: 'wifi_scan' });
    // Use esp-idf native API (both boards use esp-idf framework)
    return `
    if (sub_step == 0) {
      ESP_LOGI("selftest", "=== WiFi Scan ===");
      wifi_scan_config_t scan_config = {};
      scan_config.show_hidden = false;
      scan_config.scan_type = WIFI_SCAN_TYPE_ACTIVE;
      scan_config.scan_time.active.min = 100;
      scan_config.scan_time.active.max = 300;
      esp_err_t err = esp_wifi_scan_start(&scan_config, false);
      if (err != ESP_OK) {
        char detail[64];
        snprintf(detail, sizeof(detail), "Scan start failed: %s", esp_err_to_name(err));
        record("WiFi Scan", false, detail);
        id(${rid}).publish_state(false);
        id(${did}).publish_state(detail);
        next_phase();
        return;
      }
      step_timer = millis();
      sub_step = 1;
    } else if (sub_step == 1) {
      // Poll for scan completion
      uint16_t ap_count = 0;
      esp_err_t err = esp_wifi_scan_get_ap_num(&ap_count);
      if (err == ESP_OK && ap_count > 0) {
        esp_wifi_scan_stop();
        char detail[64];
        snprintf(detail, sizeof(detail), "%d networks found", ap_count);
        record("WiFi Scan", true, detail);
        id(${rid}).publish_state(true);
        id(${did}).publish_state(detail);
        next_phase();
      } else if (millis() - step_timer >= 10000) {
        esp_wifi_scan_stop();
        char detail[64];
        snprintf(detail, sizeof(detail), "Scan timeout (10s), %d APs", ap_count);
        bool ok = (ap_count > 0);
        record("WiFi Scan", ok, detail);
        id(${rid}).publish_state(ok);
        id(${did}).publish_state(detail);
        next_phase();
      }
    }`;
  },

  yaml: () => ({}),
};
