/**
 * Icon categories for board peripherals.
 * Each peripheral in the board definition can specify `icon: "display"` etc.
 * If omitted, the key name is matched against this map, falling back to "chip".
 *
 * Categories:
 *   display   — screens, OLEDs, LCDs
 *   radio     — LoRa, WiFi, BLE, cellular
 *   power     — battery, solar, voltage regulators
 *   light     — LEDs, NeoPixels, indicators
 *   sensor    — temperature, humidity, pressure
 *   relay     — relays, solid-state switches
 *   io        — GPIO expanders, shift registers
 *   chip      — generic IC / fallback
 */

// Heroicons outline paths (24x24 viewBox)
const ICON_PATHS: Record<string, string> = {
  display:
    'M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z',
  radio:
    'M8.111 16.404a5.5 5.5 0 017.778 0M12 20h.01m-7.08-7.071c3.904-3.905 10.236-3.905 14.141 0M1.394 9.393c5.857-5.858 15.355-5.858 21.213 0',
  power:
    'M17 10H7m10-2H7a2 2 0 00-2 2v4a2 2 0 002 2h10a2 2 0 002-2v-4a2 2 0 00-2-2zm4 3v2',
  light:
    'M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z',
  sensor:
    'M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z',
  relay:
    'M13 10V3L4 14h7v7l9-11h-7z',
  io:
    'M4 5a1 1 0 011-1h14a1 1 0 011 1v2a1 1 0 01-1 1H5a1 1 0 01-1-1V5zm0 8a1 1 0 011-1h14a1 1 0 011 1v2a1 1 0 01-1 1H5a1 1 0 01-1-1v-2z',
  chip:
    'M9 3v2m6-2v2M9 19v2m6-2v2M5 9H3m2 6H3m18-6h-2m2 6h-2M7 19h10a2 2 0 002-2V7a2 2 0 00-2-2H7a2 2 0 00-2 2v10a2 2 0 002 2zM9 9h6v6H9V9z',
};

// Map peripheral key names to icon categories
const KEY_TO_ICON: Record<string, string> = {
  oled: 'display',
  display: 'display',
  lcd: 'display',
  lora: 'radio',
  wifi: 'radio',
  ble: 'radio',
  cellular: 'radio',
  battery: 'power',
  solar: 'power',
  led: 'light',
  neopixel: 'light',
  relay: 'relay',
  expander: 'io',
  mcp23017: 'io',
  vext: 'power',
};

/** Get the SVG path for a peripheral. Checks explicit `icon` field first, then key name, then falls back to "chip". */
export function peripheralIconPath(key: string, explicitIcon?: string): string {
  if (explicitIcon && ICON_PATHS[explicitIcon]) return ICON_PATHS[explicitIcon];
  const mapped = KEY_TO_ICON[key.toLowerCase()];
  if (mapped && ICON_PATHS[mapped]) return ICON_PATHS[mapped];
  return ICON_PATHS['chip'];
}

/** Human-readable label from a peripheral key. */
export function peripheralLabel(key: string): string {
  const labels: Record<string, string> = {
    oled: 'OLED Display',
    lora: 'LoRa Radio',
    battery: 'Battery Monitor',
    led: 'Onboard LED',
    vext: 'Vext Power Gate',
  };
  return labels[key] ?? key.charAt(0).toUpperCase() + key.slice(1);
}

/** Short description from a peripheral value object. */
export function peripheralDescription(key: string, value: Record<string, unknown>): string {
  if (value['model']) return String(value['model']);
  if (value['chip']) return String(value['chip']);
  if (value['pin']) return String(value['pin']);
  if (value['adc_pin']) return `ADC: ${value['adc_pin']}`;
  return 'Enabled';
}
