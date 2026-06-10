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
  // No baked credentials. Wifi is provisioned ON THE DEVICE and stored in its
  // own flash (NVS) — never in the firmware or our DB ("no stored wifi
  // passwords"). On first boot (empty NVS) the device comes up in AP mode and
  // serves the setup page; once creds are saved it joins that network, and they
  // survive OTA as long as the partition table + `wifi:` block stay stable.
  //
  // Two on-device provisioning surfaces are emitted:
  //   - captive_portal — the AP-mode setup page. web_server does NOT bind the AP
  //     interface (esphome/issues#4333, confirmed empirically — nothing serves
  //     at 192.168.4.1 without it); captive_portal is the only ESPHome component
  //     that serves HTTP on the AP. POST /wifisave writes creds to NVS.
  //   - improv_serial (emitImprov below) — USB/WebSerial provisioning via
  //     improv-wifi.com, preferred when a cable + Chromium browser are handy.
  // Because no creds live in YAML, the captive_portal blank-page degradation
  // (esphome/issues#6784, creds-in-YAML only) does not apply here.
  //
  // The setup AP is open (provisioning-only — no control surface binds to it);
  // add an `ap.password` later if it ever needs locking down.
  return [
    {
      wifi: {
        ...(manualIp && { manual_ip: manualIp }),
        // An unreachable AP must not reboot the device — it runs local control
        // autonomously and falls back to the setup AP below. 0s disables
        // ESPHome's 15-min default WiFi-loss reboot.
        reboot_timeout: '0s',
        ap: {
          ssid: '${friendly_name} Setup',
        },
      },
    },
    { captive_portal: null },
  ];
}

// Wifi (re)provisioning over USB serial: the user opens improv-wifi.com via
// WebSerial on the flashing cable and sends SSID + password. Works even when
// the device can't reach any AP. Requires `wifi:` configured. Pairs with
// captive_portal (emitWifi) for the no-cable path — the device falls back to
// its open `<name> Setup` AP and serves the setup page there.
//
// BLE provisioning (esp32_improv) is intentionally NOT emitted. The ESP32 BLE
// stack costs ~95 KB of heap; on managed/TLS builds (web_server + MQTT over
// esp-idf/TLS) that left almost no free heap, so the MQTT-connect state burst
// exhausted it and bootlooped the device. captive_portal + serial improv cover
// provisioning without that cost. See docs-content/troubleshooting.md.
function emitImprov(): Record<string, unknown>[] {
  // improv_serial is MCU-agnostic (UART-only), always safe to emit.
  return [{ improv_serial: null }];
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
      : [...emitWifi(manualIp), ...emitImprov()];
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
