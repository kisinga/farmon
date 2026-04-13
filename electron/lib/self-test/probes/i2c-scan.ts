import type { TestProbe } from '../probe.js';
import { resultId, detailId } from '../probe.js';

export const i2cScanProbe: TestProbe = {
  id: 'i2c_scan',
  label: 'I2C Bus Scan',

  appliesTo: (board) => (board.expanders?.length ?? 0) > 0,

  constants: (board) => {
    const addrs = board.expanders!.map(e => {
      const a = typeof e.address === 'number' ? e.address : parseInt(String(e.address), 16);
      return `0x${a.toString(16).padStart(2, '0')}`;
    });
    return [
      `static const uint8_t EXPANDER_ADDRS[] = { ${addrs.join(', ')} };`,
      `static const int NUM_EXPANDERS = ${board.expanders!.length};`,
    ].join('\n  ');
  },

  state: () => '',
  helpers: () => '',

  tick: () => {
    const rid = resultId({ id: 'i2c_scan' });
    const did = detailId({ id: 'i2c_scan' });
    return `
    if (sub_step == 0) {
      ESP_LOGI("selftest", "=== I2C Bus Scan (%d expanders) ===", NUM_EXPANDERS);
      bool all_ok = true;
      char detail[64] = "";
      int dlen = 0;
      for (int i = 0; i < NUM_EXPANDERS; i++) {
        Wire.beginTransmission(EXPANDER_ADDRS[i]);
        uint8_t err = Wire.endTransmission();
        bool ok = (err == 0);
        if (!ok) all_ok = false;
        dlen += snprintf(detail + dlen, sizeof(detail) - dlen,
          "0x%02X:%s ", EXPANDER_ADDRS[i], ok ? "OK" : "FAIL");
      }
      record("I2C Bus Scan", all_ok, detail);
      id(${rid}).publish_state(all_ok);
      id(${did}).publish_state(detail);
      next_phase();
    }`;
  },

  yaml: () => ({}),
};
