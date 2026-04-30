/**
 * Shared Zod primitives — used by entity files and electron topology parser.
 * Single source of truth for validation patterns.
 */
import { z } from 'zod';
import { type InputPolicy, policyString } from './input-policy';

/** Valid pin/channel reference: native GPIO (GPIO0–GPIO99), expander pin (OUT1, IN16),
 *  provider channel (mux1:CH3, io_exp1:DO5), or empty string. */
export const GpioPin = z.union([
  z.string().regex(/^(GPIO\d{1,2}|[A-Z]+\d{1,2})$/, 'Must be GPIOnn or expander pin format'),
  z.string().regex(/^[a-z_][a-z0-9_]*:[A-Z]+[0-9]+$/, 'Must be provider:CHANNEL format (e.g., mux1:CH3)'),
  z.literal(''),
]);

/** Policy for ESPHome/C++ identifiers: lowercase letters, digits, underscores. */
export const COMPONENT_ID_POLICY: InputPolicy = {
  pattern: /^[a-z][a-z0-9_]*$/,
  allow: /[a-z0-9_]/g,
  lowercase: true,
  hint: 'Lowercase letters, digits, underscores; must start with a letter — e.g. modbus_bus_1',
};

/** Valid ESPHome/C++ identifier. */
export const ComponentId = policyString(COMPONENT_ID_POLICY);

export const PortSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  direction: z.enum(['inlet', 'outlet']),
});

/**
 * Relay polarity per output: chooses which electrical level holds the relay OFF.
 * `active_low` (default) — relay turns ON when GPIO is LOW (most opto-isolated modules).
 * `active_high` — relay turns ON when GPIO is HIGH.
 * Pick whichever matches the relay module so the load is OFF whenever the MCU is
 * not actively driving the line (boot, reset, brown-out, crash).
 */
export const RelayPolaritySchema = z
  .enum(['active_low', 'active_high'])
  .default('active_low');

export type RelayPolarity = z.infer<typeof RelayPolaritySchema>;

export const PositionSchema = z.object({ x: z.number(), y: z.number() });

export type Port = z.infer<typeof PortSchema>;
export type Position = z.infer<typeof PositionSchema>;

// ---------------------------------------------------------------------------
// Device & timing schemas (previously in electron/lib/shared-schema.ts)
// ---------------------------------------------------------------------------

export const UartBusSchema = z.object({
  id: ComponentId,
  tx_pin: GpioPin,
  rx_pin: GpioPin,
  de_pin: GpioPin.optional(),
  baud_rate: z.number().default(9600),
});

export const NetworkConfigSchema = z.object({
  // Undefined → auto (ethernet for ethernet-capable boards, wifi otherwise).
  transport: z.enum(['ethernet', 'wifi']).optional(),
  mode: z.enum(['dhcp', 'static']).default('dhcp'),
  static_ip: z.string().optional(),
  gateway: z.string().optional(),
  subnet: z.string().optional(),
  dns1: z.string().optional(),
  dns2: z.string().optional(),
});

export const IoProviderDefSchema = z.object({
  id: ComponentId,
  type: z.string().min(1),
  config: z.record(z.unknown()),
});

export const DeviceSchema = z.object({
  name: z.string().min(1),
  friendly_name: z.string().min(1),
  board: z.string().min(1),
  directory: z.string().optional(),
  uart_buses: z.array(UartBusSchema).default([]),
  io_providers: z.array(IoProviderDefSchema).default([]),
  network: NetworkConfigSchema.optional(),
});

export const TimingSchema = z.object({
  valve_travel_time: z.number().gt(1).default(15),
  flow_watchdog: z.number().gt(1).default(30),
  flow_confirm: z.number().gt(1).default(15),
  api_watchdog: z.number().gt(1).default(300),
  update_interval: z.number().gt(1).default(5),
});

export const AutomationTriggerSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("time"), at: z.string().regex(/^\d{2}:\d{2}$/, 'Must be HH:MM format') }),
  z.object({
    type: z.literal("level"),
    node: z.string().optional(),
    entity: z.string().optional(),
    below: z.number().optional(),
    above: z.number().optional(),
    for_minutes: z.number().gt(1).optional(),
  }),
]);

export const AutomationSchema = z.object({
  id: ComponentId,
  name: z.string().default(''),
  route: z.string().default(''),
  trigger: AutomationTriggerSchema,
  days_of_week: z.array(z.enum(['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN']))
    .default(['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN']),
  enabled: z.boolean().default(true),
});

// ---------------------------------------------------------------------------
// XML/SVG utility
// ---------------------------------------------------------------------------

/** Escape a string for safe use in XML/SVG text content. */
export function escXml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ---------------------------------------------------------------------------
// Duration parsing utility
// ---------------------------------------------------------------------------

/** Parse an ESPHome duration string like "15s" or "2000ms" to milliseconds. */
export function parseDurationMs(s: string): number {
  const ms = s.match(/^(\d+)\s*ms$/);
  if (ms) return parseInt(ms[1], 10);
  const sec = s.match(/^(\d+)\s*s$/);
  if (sec) return parseInt(sec[1], 10) * 1000;
  return 15000; // fallback
}
