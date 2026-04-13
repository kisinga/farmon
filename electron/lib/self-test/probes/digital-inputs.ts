import type { TestProbe } from '../probe.js';
import { resultId, detailId, inputPins } from '../probe.js';

export const digitalInputsProbe: TestProbe = {
  id: 'digital_inputs',
  label: 'Digital Inputs',

  appliesTo: (board) => inputPins(board).length > 0,

  constants: (board) => {
    // Input expander addresses — for write/readback pattern test
    const inputExpIds = new Set(inputPins(board).map(p => p.expander!));
    const expanders = (board.expanders ?? []).filter(e => inputExpIds.has(e.id));
    const addrs = expanders.map(e => {
      const a = typeof e.address === 'number' ? e.address : parseInt(String(e.address), 16);
      return `0x${a.toString(16).padStart(2, '0')}`;
    });
    return [
      `static const int NUM_INPUTS = ${inputPins(board).length};`,
      `static const uint8_t INPUT_EXPANDER_ADDRS[] = { ${addrs.join(', ')} };`,
      `static const int NUM_INPUT_EXPANDERS = ${expanders.length};`,
    ].join('\n  ');
  },

  state: () => [
    'static int input_fail_count = 0;',
    'static char input_detail[128] = "";',
    'static int input_detail_len = 0;',
  ].join('\n  '),

  helpers: () => `
  // Write a byte to PCF8574 and read it back
  bool pcf_write_read(uint8_t addr, uint8_t pattern) {
    auto &bus = id(i2c_bus);
    // Write pattern
    i2c::ErrorCode werr = bus.write(addr, &pattern, 1, true);
    if (werr != i2c::ERROR_OK) return false;
    // Read back
    uint8_t readback = 0;
    i2c::ErrorCode rerr = bus.read(addr, &readback, 1);
    if (rerr != i2c::ERROR_OK) return false;
    return readback == pattern;
  }`,

  tick: () => {
    const rid = resultId({ id: 'digital_inputs' });
    const did = detailId({ id: 'digital_inputs' });
    // sub_step 0: write 0xAA pattern, verify
    // sub_step 1: write 0x55 pattern, verify
    // sub_step 2: restore 0xFF (inputs), record result
    return `
    if (sub_step == 0) {
      ESP_LOGI("selftest", "=== Digital Inputs (%d inputs, %d expanders) ===", NUM_INPUTS, NUM_INPUT_EXPANDERS);
      input_fail_count = 0;
      input_detail_len = 0;
      input_detail[0] = '\\0';
      // Test pattern 0xAA (10101010)
      for (int i = 0; i < NUM_INPUT_EXPANDERS; i++) {
        bool ok = pcf_write_read(INPUT_EXPANDER_ADDRS[i], 0xAA);
        if (!ok) {
          input_fail_count++;
          input_detail_len += snprintf(input_detail + input_detail_len,
            sizeof(input_detail) - input_detail_len, "0x%02X:0xAA_FAIL ", INPUT_EXPANDER_ADDRS[i]);
        }
        ESP_LOGI("selftest", "Input exp 0x%02X pattern 0xAA: %s", INPUT_EXPANDER_ADDRS[i], ok ? "OK" : "FAIL");
      }
      sub_step = 1;
    } else if (sub_step == 1) {
      // Test pattern 0x55 (01010101)
      for (int i = 0; i < NUM_INPUT_EXPANDERS; i++) {
        bool ok = pcf_write_read(INPUT_EXPANDER_ADDRS[i], 0x55);
        if (!ok) {
          input_fail_count++;
          input_detail_len += snprintf(input_detail + input_detail_len,
            sizeof(input_detail) - input_detail_len, "0x%02X:0x55_FAIL ", INPUT_EXPANDER_ADDRS[i]);
        }
        ESP_LOGI("selftest", "Input exp 0x%02X pattern 0x55: %s", INPUT_EXPANDER_ADDRS[i], ok ? "OK" : "FAIL");
      }
      sub_step = 2;
    } else if (sub_step == 2) {
      // Restore default (0xFF = all inputs high)
      for (int i = 0; i < NUM_INPUT_EXPANDERS; i++) {
        uint8_t restore = 0xFF;
        id(i2c_bus).write(INPUT_EXPANDER_ADDRS[i], &restore, 1, true);
      }
      bool pass = (input_fail_count == 0);
      if (input_detail_len == 0) {
        snprintf(input_detail, sizeof(input_detail),
          "%d expanders: 0xAA+0x55 write/readback OK", NUM_INPUT_EXPANDERS);
      }
      record("Digital Inputs", pass, input_detail);
      id(${rid}).publish_state(pass);
      id(${did}).publish_state(input_detail);
      next_phase();
    }`;
  },

  yaml: () => ({}), // No internal YAML components needed — uses I2C bus directly
};
