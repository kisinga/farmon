import type { TestProbe } from '../probe.js';
import { resultId, detailId, inputId, inputPins } from '../probe.js';
import { resolvePinYaml } from '@far-mon/core';

export const digitalInputsProbe: TestProbe = {
  id: 'digital_inputs',
  label: 'Digital Inputs',

  appliesTo: (board) => inputPins(board).length > 0,

  constants: (board) => `static const int NUM_INPUTS = ${inputPins(board).length};`,
  state: () => '',
  helpers: () => '',

  tick: (board) => {
    const inputs = inputPins(board);
    const rid = resultId({ id: 'digital_inputs' });
    const did = detailId({ id: 'digital_inputs' });
    const readLines = inputs.map(p =>
      `      { bool s = id(${inputId(p)}).state; if (s) hi++; else lo++; }`
    ).join('\n');

    return `
    if (sub_step == 0) {
      ESP_LOGI("selftest", "=== Digital Input Baseline (%d inputs) ===", NUM_INPUTS);
      char detail[128] = "";
      int hi = 0, lo = 0;
${readLines}
      snprintf(detail, sizeof(detail), "%d HIGH, %d LOW (no external source)", hi, lo);
      record("Digital Inputs", true, detail);
      id(${rid}).publish_state(true);
      id(${did}).publish_state(detail);
      next_phase();
    }`;
  },

  yaml: (board) => {
    const inputs = inputPins(board);
    const blocks = inputs.map(pin => {
      const pinYaml = resolvePinYaml(pin.gpio, board, { mode: '{ input: true }' });
      const indentedPin = pinYaml.split('\n').map(l => `      ${l.trim()}`).join('\n');
      return `  - platform: gpio
    pin:
${indentedPin}
    id: ${inputId(pin)}
    name: "Input ${pin.gpio}"
    internal: true`;
    });
    return { binary_sensor: blocks.join('\n\n') };
  },
};
