import { stringify, Scalar } from "yaml";
import type { BoardDef } from '@core';
import { boardSupportedTransports, effectiveTransport, SYSTEM_ENTITY_NAMES, BATTERY_ENTITY_NAMES, type NetworkConfig } from "@core";
import {
  emitConnectionProfile,
  emitTransportSignalSensor,
} from "./networking";

const SYS = SYSTEM_ENTITY_NAMES;
const BAT = BATTERY_ENTITY_NAMES;

/** Create a YAML !secret tagged scalar — serializes as `!secret name` (unquoted). */
function secret(name: string): Scalar {
  const s = new Scalar(name);
  s.tag = '!secret';
  return s;
}


/** ESP32 strapping pins that trigger ESPHome warnings if used without acknowledgement. */
const ESP32_STRAPPING_PINS = new Set(['GPIO0', 'GPIO2', 'GPIO5', 'GPIO12', 'GPIO15']);
const ESP32S3_STRAPPING_PINS = new Set(['GPIO0', 'GPIO3', 'GPIO45', 'GPIO46']);

/**
 * Generate the ESPHome board package YAML from a board definition.
 * This replaces the hand-written heltec_board.yaml — every section is
 * driven by the board's declared peripherals and buses.
 */
export function generateBoardPackage(board: BoardDef, network?: NetworkConfig): string {
  const sections: Record<string, unknown>[] = [];

  // --- MCU ---
  sections.push({
    esp32: {
      variant: board.mcu.variant,
      flash_size: board.mcu.flash_size,
      ...(board.mcu.cpu_frequency && { cpu_frequency: board.mcu.cpu_frequency }),
      framework: { type: board.mcu.framework },
    },
  });

  // --- Logger ---
  sections.push({ logger: { hardware_uart: "UART0" } });

  // --- Connection (transport + IP + dashboard) ---
  // Compute transport once and reuse for diagnostic sensors so they always
  // match the active transport (ethernet_info / wifi_info / wifi_signal).
  const transport = effectiveTransport(network, boardSupportedTransports(board));
  sections.push(...emitConnectionProfile(board, network));

  sections.push({
    ota: [{ platform: "esphome", password: secret('ota_password') }],
  });

  // --- Buses ---
  const strappingPins = board.mcu.variant === 'esp32s3'
    ? ESP32S3_STRAPPING_PINS : ESP32_STRAPPING_PINS;

  for (const [busName, busDef] of Object.entries(board.buses)) {
    // UART buses are user-configured per-topology (device-yaml.ts), not in the board package.
    // The bus entry still reserves the pins via reservedPins().
    if (busName === 'uart') continue;
    const busConfig: Record<string, unknown> = { id: `${busName}_bus` };
    for (const [key, val] of Object.entries(busDef)) {
      const pinVal = typeof val === 'string' && /^GPIO\d+$/.test(val) ? val : null;
      if (busName === "spi") {
        busConfig[`${key}_pin`] = val;
      } else if (pinVal && strappingPins.has(pinVal)) {
        // Strapping pins need structured block with ignore_strapping_warning
        busConfig[key] = { number: pinVal, ignore_strapping_warning: true };
      } else {
        busConfig[key] = val;
      }
    }
    sections.push({ [busName]: busConfig });
  }

  // --- I2C GPIO Expanders ---
  if (board.expanders && board.expanders.length > 0) {
    // Group expanders by platform (pcf8574, pcf8575, mcp23017, etc.)
    const byPlatform = new Map<string, unknown[]>();
    for (const exp of board.expanders) {
      const platform = exp.platform;
      if (!byPlatform.has(platform)) byPlatform.set(platform, []);
      byPlatform.get(platform)!.push({
        id: exp.id,
        address: `0x${exp.address.toString(16).padStart(2, '0')}`,
        ...(exp.pcf8575 != null && { pcf8575: exp.pcf8575 }),
      });
    }
    for (const [platform, entries] of byPlatform) {
      sections.push({ [platform]: entries });
    }
  }

  // --- Peripherals: switches, outputs, lights ---
  const switches: unknown[] = [];
  const outputs: unknown[] = [];
  const lights: unknown[] = [];

  if (board.peripherals.vext) {
    switches.push({
      platform: "gpio",
      pin: board.peripherals.vext.pin,
      id: "vext",
      name: SYS.vextControl.name,
      inverted: true,
      restore_mode: "ALWAYS_ON",
    });
  }

  if (board.peripherals.led) {
    outputs.push({
      platform: "gpio",
      pin: board.peripherals.led.pin,
      id: "led_output",
    });
    lights.push({
      platform: "binary",
      name: SYS.onboardLed.name,
      output: "led_output",
    });
  }

  if (board.peripherals.battery) {
    outputs.push({
      platform: "gpio",
      pin: board.peripherals.battery.enable_pin,
      id: "bat_adc_enable",
      inverted: true,
    });
  }

  if (switches.length > 0) sections.push({ switch: switches });
  if (outputs.length > 0) sections.push({ output: outputs });
  if (lights.length > 0) sections.push({ light: lights });

  // --- Fonts & images (only if OLED present) ---
  if (board.peripherals.oled) {
    sections.push({
      font: [
        {
          file: "gfonts://Roboto+Condensed",
          id: "font_top_bar",
          size: 10,
          bpp: 1,
          glyphs:
            ' !"#$%&()*+,-./0123456789:;<=>?@ABCDEFGHIJKLMNOPQRSTUVWXYZ[]abcdefghijklmnopqrstuvwxyz{}|',
        },
        {
          file: "gfonts://Roboto+Condensed",
          id: "font_body",
          size: 10,
          bpp: 1,
          glyphs:
            ' !"#$%&()*+,-./0123456789:;<=>?@ABCDEFGHIJKLMNOPQRSTUVWXYZ[]abcdefghijklmnopqrstuvwxyz{}|\u00b0',
        },
      ],
    });
    sections.push({
      image: [
        {
          file: "common/images/logo.svg",
          id: "logo_splash",
          resize: "60x60",
          type: "BINARY",
        },
        {
          file: "common/images/logo.svg",
          id: "logo_small",
          resize: "40x40",
          type: "BINARY",
        },
      ],
    });
  }

  // --- Sensors (diagnostics — always present) ---
  const sensors: unknown[] = [];

  if (board.peripherals.battery) {
    const bat = board.peripherals.battery;
    sensors.push({
      platform: "adc",
      pin: "${pin_battery_adc}",
      id: "battery_voltage",
      name: BAT.batteryVoltage.name,
      unit_of_measurement: "V",
      icon: "mdi:battery",
      accuracy_decimals: 2,
      attenuation: "12db",
      update_interval: "never",
      filters: [
        { multiply: "${battery_divider}" },
        { exponential_moving_average: { alpha: 0.3, send_every: 1 } },
      ],
    });
    sensors.push({
      platform: "copy",
      source_id: "battery_voltage",
      id: "battery_percent",
      name: BAT.batteryPercent.name,
      unit_of_measurement: "%",
      icon: "mdi:battery",
      accuracy_decimals: 0,
      filters: [
        {
          calibrate_linear: {
            method: "exact",
            datapoints: bat.calibration.map(
              ([v, pct]) => `${v} -> ${pct}`
            ),
          },
        },
        { clamp: { min_value: 0, max_value: 100 } },
      ],
    });
  }

  const signalSensor = emitTransportSignalSensor(transport);
  if (signalSensor) sensors.push(signalSensor);
  sensors.push({
    platform: "uptime",
    name: SYS.uptime.name,
    update_interval: "${update_interval}",
    id: "uptime_sec",
  });
  sensors.push({
    platform: "internal_temperature",
    name: SYS.esp32Temperature.name,
    update_interval: "${update_interval}",
    id: "esp_temp",
  });

  sections.push({ sensor: sensors });

  // Text-sensor diagnostics are emitted by emitConnectionProfile alongside
  // the transport block — keeps networking concerns in one place.

  // --- Battery ADC enable interval (only if battery present) ---
  if (board.peripherals.battery) {
    sections.push({
      interval: [
        {
          interval: "${update_interval}",
          then: [
            { "output.turn_on": "bat_adc_enable" },
            { delay: "20ms" },
            { "component.update": "battery_voltage" },
            { "output.turn_off": "bat_adc_enable" },
          ],
        },
      ],
    });
  }

  // --- Assemble ---
  const header = [
    "# =============================================================================",
    `# ${board.label} — Board Package`,
    "# =============================================================================",
    "# AUTO-GENERATED from board definition. Do not edit by hand.",
    `# Board: boards/${board.model.replace("_", "-")}/board.yaml`,
    "#",
    "# Provides: MCU config, buses, networking, OTA, diagnostics",
    board.peripherals.battery ? "#   + Battery monitoring" : null,
    board.peripherals.led ? "#   + Onboard LED" : null,
    board.peripherals.vext ? "#   + Vext power gate" : null,
    board.peripherals.oled ? "#   + OLED fonts and images" : null,
    board.peripherals.lora ? "#   + LoRa SPI bus reservation" : null,
    board.peripherals.ethernet ? "#   + Ethernet (LAN8720)" : null,
    board.expanders?.length ? `#   + ${board.expanders.length}x I2C GPIO expanders` : null,
    "#",
    "# Requires substitutions: ${friendly_name}, ${update_interval}",
    board.peripherals.battery
      ? "#   ${pin_battery_adc}, ${battery_divider}"
      : null,
    "# =============================================================================",
  ]
    .filter(Boolean)
    .join("\n") + "\n\n";

  // Merge all sections into a single object so we produce one YAML document
  const merged: Record<string, unknown> = {};
  for (const section of sections) {
    for (const [key, val] of Object.entries(section)) {
      merged[key] = val;
    }
  }

  const body = stringify(merged, {
    indent: 2,
    lineWidth: 0,
    defaultStringType: "PLAIN",
  });


  return header + body;
}
