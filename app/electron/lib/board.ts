import { z } from "zod";
import * as fs from "node:fs";
import * as path from "node:path";
import { parse as parseYaml } from "yaml";

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
export type PinCapability = z.infer<typeof PinCapability>;

// --- Board definition schema ------------------------------------------------

const GpioPin = z.string().regex(/^GPIO\d{1,2}$/);

const PinDefSchema = z.object({
  gpio: GpioPin,
  connector: z.string(),
  edge: z.enum(["top", "bottom", "left", "right"]),
  caps: z.array(PinCapability),
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
});

const BatterySchema = z.object({
  adc_pin: GpioPin,
  enable_pin: GpioPin,
  divider: z.number(),
  calibration: z.array(z.tuple([z.number(), z.number()])),
});

const LedSchema = z.object({ pin: GpioPin });
const VextSchema = z.object({ pin: GpioPin });

const PeripheralsSchema = z.object({
  oled: OledSchema.optional(),
  lora: LoraSchema.optional(),
  battery: BatterySchema.optional(),
  led: LedSchema.optional(),
  vext: VextSchema.optional(),
});

const BusSchema = z.record(z.union([GpioPin, z.string(), z.number()]));

export const BoardDefSchema = z.object({
  schema: z.number().int().positive().optional(),
  model: z.string(),
  label: z.string(),
  svg: z.string(),
  mcu: McuSchema,
  peripherals: PeripheralsSchema,
  buses: z.record(BusSchema),
  pins: z.array(PinDefSchema),
});

export type BoardDef = z.infer<typeof BoardDefSchema>;
export type PinDef = z.infer<typeof PinDefSchema>;

// --- Derived helpers --------------------------------------------------------

/**
 * Compute all GPIO pins reserved by peripherals and buses.
 * Returns a map of GPIO → reason string.
 */
export function reservedPins(board: BoardDef): Map<string, string> {
  const reserved = new Map<string, string>();

  const p = board.peripherals;

  if (p.oled) {
    reserved.set(p.oled.reset_pin, "OLED reset");
  }
  if (p.lora) {
    for (const [fn, pin] of Object.entries(p.lora.spi_pins)) {
      reserved.set(pin, `LoRa SPI ${fn}`);
    }
  }
  if (p.battery) {
    reserved.set(p.battery.adc_pin, "battery ADC");
    reserved.set(p.battery.enable_pin, "battery ADC enable");
  }
  if (p.led) {
    reserved.set(p.led.pin, "onboard LED");
  }
  if (p.vext) {
    reserved.set(p.vext.pin, "Vext gate");
  }

  for (const [busName, busDef] of Object.entries(board.buses)) {
    for (const [fn, val] of Object.entries(busDef)) {
      if (typeof val === "string" && /^GPIO\d+$/.test(val)) {
        reserved.set(val, `${busName} ${fn}`);
      }
    }
  }

  return reserved;
}

/**
 * Set of all GPIO pins exposed on headers (available for user assignment).
 */
export function exposedPins(board: BoardDef): Set<string> {
  return new Set(board.pins.map((p) => p.gpio));
}

/**
 * Filter exposed pins by a required capability.
 */
export function pinsWithCapability(
  board: BoardDef,
  cap: PinCapability
): Set<string> {
  return new Set(
    board.pins.filter((p) => p.caps.includes(cap)).map((p) => p.gpio)
  );
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
