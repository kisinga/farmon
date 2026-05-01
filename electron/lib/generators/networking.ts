import { Scalar } from "yaml";
import type { BoardDef } from "../board.js";
import { effectiveTransport, type NetworkConfig, type NetworkTransport } from "@far-mon/core";

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
 * Emit the device's network transport (XOR ethernet/wifi per ESPHome) plus
 * the always-on `web_server:` dashboard. The chosen transport is governed
 * by `effectiveTransport(network, boardHasEthernet)` — single source of
 * truth shared with the UI.
 */
export function emitConnectionProfile(
  board: BoardDef,
  network?: NetworkConfig,
): Record<string, unknown>[] {
  const transport = effectiveTransport(network, !!board.peripherals.ethernet);
  const manualIp = manualIpFromNetwork(network);
  const sections =
    transport === 'ethernet'
      ? [emitEthernet(board.peripherals.ethernet!, manualIp)]
      : emitWifi(manualIp);
  sections.push(emitWebServer());
  return sections;
}

/**
 * Diagnostic sensor that reports signal strength for the active transport.
 * Ethernet has no equivalent (link is binary), so returns null.
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

/**
 * Diagnostic text-sensor block exposing IP and (for wifi) SSID/MAC. The
 * platform must match the active transport — ESPHome rejects
 * `ethernet_info` when ethernet isn't configured, and vice versa.
 */
export function emitTransportInfoTextSensor(
  transport: NetworkTransport,
): Record<string, unknown> {
  if (transport === 'ethernet') {
    return {
      text_sensor: [
        {
          platform: "ethernet_info",
          ip_address: { name: "IP Address", id: "ip_addr" },
        },
      ],
    };
  }
  return {
    text_sensor: [
      {
        platform: "wifi_info",
        ip_address: { name: "IP Address", id: "ip_addr" },
        ssid: { name: "Connected SSID" },
        mac_address: { name: "MAC Address" },
      },
    ],
  };
}
