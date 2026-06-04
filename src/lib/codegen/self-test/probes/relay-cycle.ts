import type { TestProbe } from '../probe';
import { resultId, detailId, relayId, relayPins } from '../probe';
import { createBoardDriver } from '@core';

export const relayCycleProbe: TestProbe = {
  id: 'relay_cycle',
  label: 'Relay Cycle',

  appliesTo: (board) => relayPins(board).length > 0,

  constants: (board) => `static const int NUM_RELAYS = ${relayPins(board).length};`,

  state: () => [
    'static int relay_fail_count = 0;',
    'static char relay_detail[128] = "";',
    'static int relay_detail_len = 0;',
  ].join('\n  '),

  helpers: (board) => {
    const relays = relayPins(board);
    const ids = relays.map(p => relayId(p));
    const expanders = board.expanders ?? [];
    const addrMap = new Map(expanders.map(e => [
      e.id,
      typeof e.address === 'number' ? e.address : parseInt(String(e.address), 16),
    ]));

    // relay_set dispatch
    const setLines = ids.map((id, i) =>
      `      case ${i}: if (on) id(${id}).turn_on(); else id(${id}).turn_off(); break;`
    ).join('\n');

    // relay_readback via I2C
    const readbackCases: string[] = [];
    for (const relay of relays) {
      const idx = relays.indexOf(relay);
      const addr = addrMap.get(relay.expander!) ?? 0;
      readbackCases.push(`      case ${idx}: {
        uint8_t reg = i2c_read_reg(0x${addr.toString(16)});
        bool bit_low = !(reg & (1 << ${relay.number}));
        return bit_low;
      }`);
    }

    return `
  void relay_set(int idx, bool on) {
    switch (idx) {
${setLines}
    }
  }

  bool relay_readback(int idx) {
    switch (idx) {
${readbackCases.join('\n')}
    }
    return false;
  }`;
  },

  tick: () => {
    const rid = resultId({ id: 'relay_cycle' });
    const did = detailId({ id: 'relay_cycle' });
    return `
    int relay_idx = sub_step / 3;
    int action = sub_step % 3;

    if (relay_idx >= NUM_RELAYS) {
      bool pass = (relay_fail_count == 0);
      if (relay_detail_len == 0) snprintf(relay_detail, sizeof(relay_detail), "All %d relays OK", NUM_RELAYS);
      record("Relay Cycle", pass, relay_detail);
      id(${rid}).publish_state(pass);
      id(${did}).publish_state(relay_detail);
      relay_fail_count = 0;
      relay_detail_len = 0;
      next_phase();
      return;
    }

    switch (action) {
      case 0:
        relay_set(relay_idx, true);
        step_timer = millis();
        sub_step++;
        break;
      case 1:
        if (millis() - step_timer >= 800) {
          bool rb = relay_readback(relay_idx);
          if (!rb) {
            relay_fail_count++;
            relay_detail_len += snprintf(relay_detail + relay_detail_len,
              sizeof(relay_detail) - relay_detail_len, "K%d:FAIL ", relay_idx + 1);
          }
          ESP_LOGI("selftest", "Relay K%d: %s", relay_idx + 1, rb ? "OK" : "READBACK_FAIL");
          relay_set(relay_idx, false);
          step_timer = millis();
          sub_step++;
        }
        break;
      case 2:
        if (millis() - step_timer >= 200) {
          sub_step++;
        }
        break;
    }`;
  },

  yaml: (board) => {
    const driver = createBoardDriver(board);
    const relays = relayPins(board);
    const blocks = relays.map(pin => {
      const ch = driver.resolve(pin.gpio, { purpose: 'digital_out', inverted: true });
      const header = `- platform: ${ch.platform}\n  ${ch.config}`;
      const indented = header.split('\n').map(l => `  ${l}`).join('\n');
      return `${indented}
    id: ${relayId(pin)}
    name: "Relay ${pin.gpio}"
    internal: true
    restore_mode: ALWAYS_OFF`;
    });
    return { switch: blocks.join('\n\n') };
  },
};
