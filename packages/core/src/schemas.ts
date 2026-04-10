/**
 * Shared Zod primitives — used by entity files and electron topology parser.
 * Single source of truth for validation patterns.
 */
import { z } from 'zod';

/** Valid GPIO pin reference: GPIO0–GPIO99, or empty string (not configured). */
export const GpioPin = z.union([
  z.string().regex(/^GPIO\d{1,2}$/, 'Must be GPIOnn format'),
  z.literal(''),
]);

/** Valid ESPHome/C++ identifier: lowercase letters, digits, underscores. */
export const ComponentId = z.string().regex(
  /^[a-z][a-z0-9_]*$/,
  'Must be a valid identifier (lowercase letters, digits, underscores; must start with a letter)',
);

export const PortSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  direction: z.enum(['inlet', 'outlet']),
});

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

export const DeviceSchema = z.object({
  name: z.string().min(1),
  friendly_name: z.string().min(1),
  board: z.string().min(1),
  directory: z.string().optional(),
  uart_buses: z.array(UartBusSchema).default([]),
});

export const TimingSchema = z.object({
  valve_travel_time: z.string().default("15s"),
  flow_watchdog_seconds: z.number().default(30),
  flow_confirm_seconds: z.number().default(15),
  api_watchdog_seconds: z.number().default(300),
  update_interval: z.string().default("5s"),
});

export const AutomationTriggerSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("time"), at: z.string().regex(/^\d{2}:\d{2}$/, 'Must be HH:MM format') }),
  z.object({
    type: z.literal("level"),
    node: z.string().optional(),
    entity: z.string().optional(),
    below: z.number().optional(),
    above: z.number().optional(),
    for_minutes: z.number().min(0).optional(),
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
