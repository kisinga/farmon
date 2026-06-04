import { Scalar } from "yaml";
import type { BoardDef } from '@core';
import { boardSupportedTransports, effectiveTransport, SYSTEM_ENTITY_NAMES, NETWORK_ENTITY_NAMES, type NetworkConfig, type NetworkTransport } from "@core";

const SYS = SYSTEM_ENTITY_NAMES;
const NET = NETWORK_ENTITY_NAMES;

type EthernetDef = NonNullable<BoardDef["peripherals"]["ethernet"]>;

interface ManualIp {
  static_ip: string;
  gateway: string;
  subnet: string;
  dns1?: string;
  dns2?: string;
}

function secret(name: string): Scalar {
  const s = new Scalar(name);
  s.tag = '!secret';
  return s;
}

function manualIpFromNetwork(network?: NetworkConfig): ManualIp | undefined {
  if (network?.mode !== 'static' || !network.static_ip) return undefined;
  return {
    static_ip: network.static_ip,
    gateway: network.gateway || '192.168.1.1',
    subnet: network.subnet || '255.255.255.0',
    ...(network.dns1 && { dns1: network.dns1 }),
    ...(network.dns2 && { dns2: network.dns2 }),
  };
}

function emitEthernet(eth: EthernetDef, manualIp?: ManualIp): Record<string, unknown> {
  return {
    ethernet: {
      type: eth.type,
      mdc_pin: eth.mdc_pin,
      mdio_pin: eth.mdio_pin,
      clk: { pin: eth.clk.pin, mode: eth.clk.mode },
      phy_addr: eth.phy_addr,
      ...(eth.power_pin && { power_pin: eth.power_pin }),
      ...(manualIp && { manual_ip: manualIp }),
    },
  };
}

function emitWifi(manualIp?: ManualIp): Record<string, unknown>[] {
  // Both `ap:` and `captive_portal:` are emitted.
  //
  // Why: web_server does NOT bind the AP interface (esphome/issues#4333,
  // confirmed empirically — nothing ever serves at 192.168.4.1 unless
  // captive_portal is present). The entity dashboard only works at the
  // device's STA IP on the home network. AP fallback exists solely for
  // wifi-credential recovery, and captive_portal is the only ESPHome
  // component that serves HTTP on the AP interface.
  //
  // Known degradation: on ESPHome 2025.2.0+ the captive_portal index
  // page renders blank when wifi creds live in YAML (esphome/issues#6784).
  // The OS captive-detect popup still fires (/generate_204 etc.) and
  // POST /wifisave still works, so credential reset is still reachable
  // — just with degraded UX. Accepted because it's the only AP-mode
  // HTTP surface ESPHome ships.
  //
  // Improv (emitImprov below) is the preferred modern recovery path.
  // The AP+captive_portal pair is the zero-dependency fallback for
  // users without a Chromium browser handy.
  return [
    {
      wifi: {
        ssid: secret('wifi_ssid'),
        password: secret('wifi_password'),
        ...(manualIp && { manual_ip: manualIp }),
        ap: {
          ssid: '${friendly_name} Fallback',
          password: secret('wifi_password'),
        },
      },
    },
    { captive_portal: null },
  ];
}

// Improv = upstream-supported credential-recovery flow that bypasses
// the broken captive_portal. Two transports, both emitted together:
//
//   esp32_improv  — provisioning over BLE (any ESP32 has BLE radio).
//                   User opens improv-wifi.com on a Chromium browser
//                   (or the ESPHome / HA companion app), pairs over
//                   BLE, sends SSID + password. Works without USB.
//   improv_serial — provisioning over the USB-UART. User opens
//                   improv-wifi.com via WebSerial and provisions over
//                   the same cable used for flashing. Works even when
//                   BLE is disabled or the device is bench-bound.
//
// Both require `wifi:` configured. authorizer: none = no physical
// button required to accept new creds (we don't expose a dedicated
// provisioning button on either board); change to `pin:` if a board
// gains one in future.
function emitImprov(board: BoardDef): Record<string, unknown>[] {
  const sections: Record<string, unknown>[] = [];
  // esp32_improv depends on the ESP32 BLE stack — only emit on ESP32 family.
  if (board.mcu.variant.startsWith('esp32')) {
    sections.push({ esp32_improv: { authorizer: 'none' } });
  }
  // improv_serial is MCU-agnostic (UART-only), always safe to emit.
  sections.push({ improv_serial: null });
  return sections;
}

function emitWebServer(): Record<string, unknown> {
  return { web_server: { port: 80, version: 3 } };
}

/**
 * All transport-coupled `text_sensor:` entries in one block:
 *  - `transport_supported` (template): comma-separated list of capabilities — board introspection.
 *  - `transport_active`    (template): the transport currently flashed.
 *  - `ethernet_info` / `wifi_info`:    IP (and SSID/MAC for wifi) — platform must match active transport.
 *
 * Consolidated to avoid two top-level `text_sensor:` keys colliding in YAML.
 */
function emitTransportTextSensors(
  supportedTransports: NetworkTransport[],
  activeTransport: NetworkTransport,
): Record<string, unknown> {
  const ipInfo = activeTransport === 'ethernet'
    ? {
        platform: 'ethernet_info',
        ip_address: { name: SYS.ipAddress.name, id: 'ip_addr' },
      }
    : {
        platform: 'wifi_info',
        ip_address: { name: SYS.ipAddress.name, id: 'ip_addr' },
        ssid: { name: NET.connectedSsid.name },
        mac_address: { name: NET.macAddress.name },
      };

  return {
    text_sensor: [
      {
        platform: 'template',
        name: SYS.transportSupported.name,
        id: 'transport_supported',
        update_interval: 'never',
        lambda: `return std::string("${supportedTransports.join(',')}");`,
      },
      {
        platform: 'template',
        name: SYS.transportActive.name,
        id: 'transport_active',
        update_interval: 'never',
        lambda: `return std::string("${activeTransport}");`,
      },
      ipInfo,
    ],
  };
}

/**
 * Emit every networking-coupled YAML section in one place:
 *  - the chosen transport block (`ethernet:` XOR `wifi:` + `captive_portal:`)
 *  - the always-on `web_server:` dashboard
 *  - all transport-coupled `text_sensor:` entries (introspection + IP info)
 *
 * The active transport is governed by `effectiveTransport(network, supported)` —
 * single source of truth shared with the UI and the doc generator.
 */
export function emitConnectionProfile(
  board: BoardDef,
  network?: NetworkConfig,
): Record<string, unknown>[] {
  const supported = boardSupportedTransports(board);
  const transport = effectiveTransport(network, supported);
  const manualIp = manualIpFromNetwork(network);
  const sections =
    transport === 'ethernet'
      ? [emitEthernet(board.peripherals.ethernet!, manualIp)]
      : [...emitWifi(manualIp), ...emitImprov(board)];
  sections.push(emitWebServer());
  sections.push(emitTransportTextSensors(supported, transport));
  return sections;
}

/**
 * Diagnostic sensor (in the main `sensor:` array) that reports wifi signal
 * strength. Ethernet has no equivalent (link is binary), so returns null.
 */
export function emitTransportSignalSensor(
  transport: NetworkTransport,
): Record<string, unknown> | null {
  if (transport === 'ethernet') return null;
  return {
    platform: "wifi_signal",
    name: NET.wifiSignal.name,
    update_interval: "${update_interval}",
    id: "wifi_dbm",
  };
}
