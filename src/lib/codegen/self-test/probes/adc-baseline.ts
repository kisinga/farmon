import type { TestProbe } from '../probe';
import { resultId, detailId, adcId, adcPins } from '../probe';

export const adcBaselineProbe: TestProbe = {
  id: 'adc_baseline',
  label: 'ADC Baseline',

  appliesTo: (board) => adcPins(board).length > 0,

  constants: (board) => `static const int NUM_ADCS = ${adcPins(board).length};`,

  state: () => [
    'static char adc_detail[128] = "";',
    'static int adc_detail_len = 0;',
  ].join('\n  '),

  helpers: () => '',

  tick: (board) => {
    const adcs = adcPins(board);
    const rid = resultId({ id: 'adc_baseline' });
    const did = detailId({ id: 'adc_baseline' });

    const triggerLines = adcs.map(p => `      id(${adcId(p)}).update();`).join('\n');
    const readLines = adcs.map((p, i) => {
      const num = p.gpio.replace('GPIO', '');
      return `        {
          float v = id(${adcId(p)}).state;
          bool ok = !std::isnan(v);
          if (!ok) all_ok = false;
          adc_detail_len += snprintf(adc_detail + adc_detail_len,
            sizeof(adc_detail) - adc_detail_len, "A${i + 1}(${num}):%.2fV ", v);
          ESP_LOGI("selftest", "ADC A${i + 1} (GPIO${num}): %.3fV %s", v, ok ? "OK" : "NaN");
        }`;
    }).join('\n');

    return `
    if (sub_step == 0) {
      ESP_LOGI("selftest", "=== ADC Baseline (%d channels) ===", NUM_ADCS);
      adc_detail_len = 0;
      adc_detail[0] = '\\0';
${triggerLines}
      step_timer = millis();
      sub_step = 1;
    } else if (sub_step == 1) {
      if (millis() - step_timer >= 200) {
        bool all_ok = true;
${readLines}
        record("ADC Baseline", all_ok, adc_detail);
        id(${rid}).publish_state(all_ok);
        id(${did}).publish_state(adc_detail);
        next_phase();
      }
    }`;
  },

  yaml: (board) => {
    const adcs = adcPins(board);
    const blocks = adcs.map(pin => `  - platform: adc
    pin: ${pin.gpio}
    id: ${adcId(pin)}
    name: "ADC ${pin.connector}"
    internal: true
    attenuation: 12db
    update_interval: never`);
    return { sensor: blocks.join('\n\n') };
  },
};
