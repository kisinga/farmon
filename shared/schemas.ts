/**
 * Shared Zod primitives — used by entity files and electron topology parser.
 * Single source of truth for validation patterns.
 */
import { z } from 'zod';

/** Valid GPIO pin reference: GPIO0–GPIO99. */
export const GpioPin = z.string().regex(/^GPIO\d{1,2}$/, 'Must be GPIOnn format');

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
