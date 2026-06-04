import type { TestProbe } from '../probe';
import { resultId, detailId } from '../probe';

export const ethernetPhyProbe: TestProbe = {
  id: 'eth_phy',
  label: 'Ethernet PHY',

  appliesTo: (board) => !!board.peripherals.ethernet,

  constants: () => '',
  state: () => '',
  helpers: () => '',

  tick: (board) => {
    const eth = board.peripherals.ethernet!;
    const rid = resultId({ id: 'eth_phy' });
    const did = detailId({ id: 'eth_phy' });
    return `
    if (sub_step == 0) {
      ESP_LOGI("selftest", "=== Ethernet PHY ===");
      bool linked = ethernet::global_eth_component != nullptr &&
                    ethernet::global_eth_component->is_connected();
      char detail[64];
      if (linked) {
        snprintf(detail, sizeof(detail), "PHY=${eth.type} addr=${eth.phy_addr} LINK_UP");
      } else {
        snprintf(detail, sizeof(detail), "PHY=${eth.type} addr=${eth.phy_addr} NO_LINK (no cable?)");
      }
      // PHY init succeeded if we reached here — report link status
      record("Ethernet PHY", true, detail);
      id(${rid}).publish_state(true);
      id(${did}).publish_state(detail);
      next_phase();
    }`;
  },

  yaml: () => ({}),
};
