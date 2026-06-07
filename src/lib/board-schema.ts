/**
 * Zod schemas for board definitions — the validation layer for importing
 * boards into the DB catalog from JSON. Mirrors the interfaces in
 * `board.types.ts`; the `satisfies z.ZodType<…>` guards make TS fail the build
 * if a schema drifts from its interface, so parity is enforced, not hoped for.
 */

import { z } from 'zod';
import type {
  PinDef, ExpanderDef, EthernetDef, BoardDef, DocSection,
  ExpansionBoardChannelDef, ExpansionBoardDef,
} from './board.types';

const DocSectionSchema = z.object({
  slug: z.string().min(1),
  title: z.string(),
  body: z.string(),
}) satisfies z.ZodType<DocSection>;

const PinCapSchema = z.enum(['digital', 'adc', 'pwm', 'pulse_counter', 'dac']);
const TransportTypeSchema = z.enum(['modbus_rtu', 'i2c_gpio']);

const PinDefSchema = z.object({
  gpio: z.string().min(1),
  connector: z.string(),
  edge: z.enum(['top', 'bottom', 'left', 'right']),
  caps: z.array(PinCapSchema),
  expander: z.string().optional(),
  number: z.number().optional(),
}) satisfies z.ZodType<PinDef>;

const ExpanderDefSchema = z.object({
  id: z.string().min(1),
  platform: z.string().min(1),
  address: z.number(),
  pcf8575: z.boolean().optional(),
}) satisfies z.ZodType<ExpanderDef>;

const EthernetDefSchema = z.object({
  type: z.string(),
  mdc_pin: z.string(),
  mdio_pin: z.string(),
  clk: z.object({ pin: z.string(), mode: z.string() }),
  phy_addr: z.number(),
  power_pin: z.string().optional(),
}) satisfies z.ZodType<EthernetDef>;

const PeripheralsSchema = z.object({
  oled: z.object({
    platform: z.string(), model: z.string(), bus: z.string(), address: z.number(),
    reset_pin: z.string(), width: z.number(), height: z.number(),
  }).optional(),
  lora: z.object({
    chip: z.string(),
    spi_pins: z.record(z.string(), z.string()),
    control_pins: z.record(z.string(), z.string()).optional(),
  }).optional(),
  battery: z.object({
    adc_pin: z.string(), enable_pin: z.string(), divider: z.number(),
    calibration: z.array(z.tuple([z.number(), z.number()])),
  }).optional(),
  led: z.object({ pin: z.string() }).optional(),
  vext: z.object({ pin: z.string() }).optional(),
  ethernet: EthernetDefSchema.optional(),
});

export const BoardDefSchema = z.object({
  model: z.string().min(1),
  label: z.string(),
  svg: z.string(),
  documentation: z.array(DocSectionSchema).optional(),
  mcu: z.object({
    variant: z.string(),
    flash_size: z.string(),
    cpu_frequency: z.string().optional(),
    framework: z.string(),
  }),
  peripherals: PeripheralsSchema,
  buses: z.record(z.string(), z.record(z.string(), z.union([z.string(), z.number()]))),
  pins: z.array(PinDefSchema),
  expanders: z.array(ExpanderDefSchema).optional(),
  uart_buses: z.array(z.object({
    id: z.string(),
    tx_pin: z.string(),
    rx_pin: z.string(),
    de_pin: z.string().optional(),
    baud_rate: z.number(),
  })).optional(),
}) satisfies z.ZodType<BoardDef>;

const ExpansionBoardChannelDefSchema = z.object({
  id: z.string().min(1),
  label: z.string().optional(),
  caps: z.array(PinCapSchema),
  modbus: z.object({
    register: z.number(),
    register_type: z.enum(['input', 'holding', 'coil', 'discrete']),
    value_type: z.string().optional(),
  }).optional(),
}) satisfies z.ZodType<ExpansionBoardChannelDef>;

export const ExpansionBoardDefSchema = z.object({
  model: z.string().min(1),
  label: z.string(),
  transport_type: TransportTypeSchema,
  channels: z.array(ExpansionBoardChannelDefSchema),
}) satisfies z.ZodType<ExpansionBoardDef>;

/** Parse + validate a main controller board definition from untrusted JSON. */
export function parseBoardDef(data: unknown): BoardDef {
  return BoardDefSchema.parse(data);
}

/** Parse + validate an expansion board definition from untrusted JSON. */
export function parseExpansionBoardDef(data: unknown): ExpansionBoardDef {
  return ExpansionBoardDefSchema.parse(data);
}
