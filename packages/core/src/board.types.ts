/**
 * Shared board definition types — the single source of truth for both
 * Electron (validated via Zod) and Angular (used as-is).
 *
 * No runtime dependencies. Pure interfaces and helper functions.
 */

export type PinCap = 'digital' | 'adc' | 'pwm' | 'pulse_counter' | 'i2c' | 'uart' | 'dac';

export interface PinDef {
  gpio: string;
  connector: string;
  edge: 'top' | 'bottom' | 'left' | 'right';
  caps: PinCap[];
  /** For I2C GPIO expander pins: ID of the expander this pin belongs to. */
  expander?: string;
  /** For I2C GPIO expander pins: port number on the expander chip. */
  number?: number;
}

export interface ExpanderDef {
  id: string;
  /** ESPHome component platform, e.g. 'pcf8574', 'pcf8575', 'mcp23017'. */
  platform: string;
  /** I2C address of the expander chip. */
  address: number;
  /** Set to true for PCF8575 (16-bit) when using the pcf8574 platform. */
  pcf8575?: boolean;
}

export interface EthernetDef {
  type: string;
  mdc_pin: string;
  mdio_pin: string;
  clk: { pin: string; mode: string };
  phy_addr: number;
  power_pin?: string;
}

export interface BoardDef {
  model: string;
  label: string;
  svg: string;
  mcu: {
    variant: string;
    flash_size: string;
    cpu_frequency?: string;
    framework: string;
  };
  peripherals: {
    oled?: { platform: string; model: string; bus: string; address: number; reset_pin: string; width: number; height: number };
    lora?: { chip: string; spi_pins: Record<string, string>; control_pins?: Record<string, string> };
    battery?: { adc_pin: string; enable_pin: string; divider: number; calibration: [number, number][] };
    led?: { pin: string };
    vext?: { pin: string };
    ethernet?: EthernetDef;
  };
  buses: Record<string, Record<string, string | number>>;
  pins: PinDef[];
  /** I2C GPIO expander chips (PCF8574, PCF8575, MCP23017, etc.). */
  expanders?: ExpanderDef[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function reservedPins(board: BoardDef): Map<string, string> {
  const reserved = new Map<string, string>();
  const p = board.peripherals;
  if (p.oled) reserved.set(p.oled.reset_pin, 'OLED reset');
  if (p.lora) {
    for (const [fn, pin] of Object.entries(p.lora.spi_pins)) {
      reserved.set(pin, `LoRa SPI ${fn}`);
    }
    if (p.lora.control_pins) {
      for (const [fn, pin] of Object.entries(p.lora.control_pins)) {
        reserved.set(pin, `LoRa ${fn}`);
      }
    }
  }
  if (p.battery) {
    reserved.set(p.battery.adc_pin, 'battery ADC');
    reserved.set(p.battery.enable_pin, 'battery ADC enable');
  }
  if (p.led) reserved.set(p.led.pin, 'onboard LED');
  if (p.vext) reserved.set(p.vext.pin, 'Vext gate');
  if (p.ethernet) {
    reserved.set(p.ethernet.mdc_pin, 'Ethernet MDC');
    reserved.set(p.ethernet.mdio_pin, 'Ethernet MDIO');
    if (p.ethernet.power_pin) reserved.set(p.ethernet.power_pin, 'Ethernet power');
    reserved.set(p.ethernet.clk.pin, 'Ethernet CLK');
  }
  for (const [busName, busDef] of Object.entries(board.buses)) {
    for (const [fn, val] of Object.entries(busDef)) {
      if (typeof val === 'string' && /^GPIO\d+$/.test(val)) {
        reserved.set(val, `${busName} ${fn}`);
      }
    }
  }
  return reserved;
}

export function exposedPins(board: BoardDef): Set<string> {
  return new Set(board.pins.map(p => p.gpio));
}

export function pinsWithCap(board: BoardDef, cap: PinCap): Set<string> {
  return new Set(board.pins.filter(p => p.caps.includes(cap)).map(p => p.gpio));
}

// Pin colors are now sourced from entity-registry via shared/colors.ts.
// Use entityColor(kind) for entity colors and UI_COLORS for reserved/selected/available.
