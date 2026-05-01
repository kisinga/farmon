import { Scalar } from "yaml";
import type { BoardDef } from "../board.js";
import { boardSupportedTransports, effectiveTransport, type NetworkConfig, type NetworkTransport } from "@far-mon/core";

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
  // The SoftAP reuses the user's wifi password — one credential for both
  // the home network and the fallback hotspot. Reachable at 192.168.4.1
  // when the device cannot reach its configured network.
  return [
    {
      wifi: {
        ssid: secret('wifi_ssid'),
        password: secret('wifi_password'),
        ...(manualIp && { manual_ip: manualIp }),
        ap: {
          ssid: "${friendly_name} Fallback",
          password: secret('wifi_password'),
        },
      },
    },
    { captive_portal: null },
  ];
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
        ip_address: { name: 'IP Address', id: 'ip_addr' },
      }
    : {
        platform: 'wifi_info',
        ip_address: { name: 'IP Address', id: 'ip_addr' },
        ssid: { name: 'Connected SSID' },
        mac_address: { name: 'MAC Address' },
      };

  return {
    text_sensor: [
      {
        platform: 'template',
        name: 'Transport (supported)',
        id: 'transport_supported',
        update_interval: 'never',
        lambda: `return std::string("${supportedTransports.join(',')}");`,
      },
      {
        platform: 'template',
        name: 'Transport (active)',
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
      : emitWifi(manualIp);
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
    name: "WiFi Signal",
    update_interval: "${update_interval}",
    id: "wifi_dbm",
  };
}
