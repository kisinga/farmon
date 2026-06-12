/**
 * Shared Zod primitives — used by entity files and the topology parser.
 * Single source of truth for validation patterns.
 */
import { z } from 'zod';
import { type InputPolicy, policyString } from './input-policy';
import { slug } from './slug';

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

/**
 * A user-facing name that must produce a non-empty slug — i.e. contain at
 * least one ASCII alphanumeric character. Required because the slug becomes
 * part of HA entity_ids (`<domain>.<friendly_name_slug>_<name_slug>`).
 * Without this, an all-emoji or all-Cyrillic name slugs to empty and silently
 * collides with other empty-slug entities in HA.
 */
export const EntityName = z
  .string()
  .min(1)
  .refine((s) => slug(s).length > 0, {
    message: 'Name must contain at least one ASCII letter or digit (used to derive HA entity_id)',
  });

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

/** The controller ID where this node is physically wired. */
export const AnchorIdSchema = z.string().min(1);

// ---------------------------------------------------------------------------
// Device & timing schemas
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

export const IoProviderInstanceConfigSchema = z.object({
  bus: z.string().min(1),
  address: z.number().int(),
});

export const IoProviderDefSchema = z.object({
  id: ComponentId,
  type: z.string().min(1),
  config: IoProviderInstanceConfigSchema,
});

export const DeviceSchema = z.object({
  name: z.string().min(1),
  // friendly_name's slug becomes the HA entity_id prefix for every entity on
  // the device — must contain at least one ASCII alphanumeric character.
  friendly_name: EntityName,
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
  flow_threshold: z.number().gt(0).default(0.5),
  // Telemetry/sensor cadence. Capped at 60s so it can never exceed the offline
  // freshness floor (120s) and make a healthy device read as offline. 10s balances
  // a live dashboard against MQTT traffic/heap; still per-device tunable at runtime.
  update_interval: z.number().gt(1).max(60).default(10),
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
