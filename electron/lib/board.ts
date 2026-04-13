import { z } from "zod";
import * as fs from "node:fs";
import * as path from "node:path";
import { parse as parseYaml } from "yaml";
import {
  type PinCap,
  reservedPins as _reservedPins,
  exposedPins as _exposedPins,
  pinsWithCap as _pinsWithCap,
} from '@far-mon/core';

// --- Pin capabilities -------------------------------------------------------

export const PinCapability = z.enum([
  "digital",
  "adc",
  "pwm",
  "pulse_counter",
  "i2c",
  "uart",
  "dac",
]);
export type PinCapability = PinCap;

// --- Board definition schema ------------------------------------------------

const GpioPin = z.string().regex(/^GPIO\d{1,2}$/);

/** Matches native GPIO pins (GPIO0-GPIO99) and expander pin names (OUT1, IN16, etc.). */
const PinRef = z.string().regex(/^(GPIO\d{1,2}|[A-Z]+\d{1,2})$/);

const PinDefSchema = z.object({
  gpio: PinRef,
  connector: z.string(),
  edge: z.enum(["top", "bottom", "left", "right"]),
  caps: z.array(PinCapability),
  expander: z.string().optional(),
  number: z.number().int().min(0).optional(),
});

const McuSchema = z.object({
  variant: z.string(),
  flash_size: z.string(),
  cpu_frequency: z.string().optional(),
  framework: z.string(),
});

const OledSchema = z.object({
  platform: z.string(),
  model: z.string(),
  bus: z.string(),
  address: z.number(),
  reset_pin: GpioPin,
  width: z.number(),
  height: z.number(),
});

const LoraSchema = z.object({
  chip: z.string(),
  spi_pins: z.record(GpioPin),
  control_pins: z.record(GpioPin).optional(),
});

const BatterySchema = z.object({
  adc_pin: GpioPin,
  enable_pin: GpioPin,
  divider: z.number(),
  calibration: z.array(z.tuple([z.number(), z.number()])),
});

const LedSchema = z.object({ pin: GpioPin });
const VextSchema = z.object({ pin: GpioPin });

const EthernetSchema = z.object({
  type: z.string(),
  mdc_pin: z.string(),
  mdio_pin: z.string(),
  clk: z.object({ pin: z.string(), mode: z.string() }),
  phy_addr: z.number().int().min(0),
  power_pin: z.string().optional(),
});

const PeripheralsSchema = z.object({
  oled: OledSchema.optional(),
  lora: LoraSchema.optional(),
  battery: BatterySchema.optional(),
  led: LedSchema.optional(),
  vext: VextSchema.optional(),
  ethernet: EthernetSchema.optional(),
});

const ExpanderSchema = z.object({
  id: z.string(),
  platform: z.string(),
  address: z.number(),
  pcf8575: z.boolean().optional(),
});

const BusSchema = z.record(z.union([z.string(), z.number()]));

export const BoardDefSchema = z.object({
  schema: z.number().int().positive().optional(),
  id: z.string().optional(),
  model: z.string(),
  label: z.string(),
  svg: z.string(),
  mcu: McuSchema,
  peripherals: PeripheralsSchema,
  buses: z.record(BusSchema),
  pins: z.array(PinDefSchema),
  expanders: z.array(ExpanderSchema).optional(),
});

export type BoardDef = z.infer<typeof BoardDefSchema>;
export type PinDef = z.infer<typeof PinDefSchema>;

// --- Derived helpers (delegated to shared/board.types.ts) -------------------

export const reservedPins = _reservedPins;
export const exposedPins = _exposedPins;

/**
 * Filter exposed pins by a required capability.
 */
export function pinsWithCapability(
  board: BoardDef,
  cap: PinCapability
): Set<string> {
  return _pinsWithCap(board, cap);
}

/**
 * Load a board definition from a directory containing board.yaml.
 */
export function loadBoard(boardDir: string): BoardDef {
  const yamlPath = path.join(boardDir, "board.yaml");
  const raw = fs.readFileSync(yamlPath, "utf-8");
  const parsed = parseYaml(raw);
  return BoardDefSchema.parse(parsed);
}

/**
 * Load a board definition from raw YAML content (no filesystem).
 */
export function loadBoardFromYaml(yamlContent: string): BoardDef {
  return BoardDefSchema.parse(parseYaml(yamlContent));
}
