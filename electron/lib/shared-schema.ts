import { z } from "zod";

// Re-export GpioPin from shared schemas (single source of truth)
export { GpioPin } from "../../shared/schemas.js";

export const DeviceSchema = z.object({
  name: z.string().min(1),
  friendly_name: z.string().min(1),
  board: z.string().min(1),
  directory: z.string().optional(),
});

export const TimingSchema = z.object({
  valve_travel_time: z.string().default("15s"),
  flow_watchdog_seconds: z.number().default(30),
  flow_confirm_seconds: z.number().default(15),
  api_watchdog_seconds: z.number().default(300),
  update_interval: z.string().default("5s"),
});

// Re-export ComponentId from shared schemas
export { ComponentId } from "../../shared/schemas.js";
import { ComponentId } from "../../shared/schemas.js";

export const AutomationTriggerSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("time"), at: z.string().regex(/^\d{2}:\d{2}$/, 'Must be HH:MM format') }),
  z.object({ type: z.literal("level"), entity: z.string().min(1), below: z.number().optional(), above: z.number().optional() }),
]);

export const AutomationSchema = z.object({
  id: ComponentId,
  name: z.string().default(''),
  route: z.string().default(''),
  trigger: AutomationTriggerSchema,
  days_of_week: z.array(z.enum(['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN']))
    .default(['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN']),
  conditions: z.object({
    source_min_level: z.number().min(0).max(100).optional(),
    dest_max_level: z.number().min(0).max(100).optional(),
  }).default({}),
  enabled: z.boolean().default(true),
});

export type Device = z.infer<typeof DeviceSchema>;
export type Timing = z.infer<typeof TimingSchema>;
export type Automation = z.infer<typeof AutomationSchema>;
