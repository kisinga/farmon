import { z } from "zod";

// ---------------------------------------------------------------------------
// Shared Zod primitives used by both topology.ts and schema.ts
// ---------------------------------------------------------------------------

export const GpioPin = z.string().regex(/^GPIO\d{1,2}$/, "Must be GPIOnn format");

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

export type Device = z.infer<typeof DeviceSchema>;
export type Timing = z.infer<typeof TimingSchema>;
