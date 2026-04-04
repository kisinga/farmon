import { z } from "zod";

const GpioPin = z.string().regex(/^GPIO\d{1,2}$/, "Must be GPIOnn format");

const DeviceSchema = z.object({
  name: z.string().min(1),
  friendly_name: z.string().min(1),
  board: z.string().min(1),  // references a board definition in boards/
  directory: z.string().optional(), // override output dir name (default: device name)
});

const PumpSchema = z.object({
  pin: GpioPin,
});

const TankSchema = z.object({
  name: z.string().min(1),
  id: z.string().min(1),
  level_pin: GpioPin,
});

const ValveSchema = z.object({
  name: z.string().min(1),
  id: z.string().min(1),
  open_pin: GpioPin,
  close_pin: GpioPin,
});

const FlowSensorSchema = z.object({
  name: z.string().min(1),
  id: z.string().min(1),
  pin: GpioPin,
});

const RouteSchema = z.object({
  name: z.string().min(1),
  source: z.string().min(1),
  destination: z.string().optional(),
  valves: z.array(z.string().min(1)).min(1),
  flow_sensor: z.string().min(1),
  max_runtime_seconds: z.number().default(1800),
});

const TimingSchema = z.object({
  valve_travel_time: z.string().default("15s"),
  flow_watchdog_seconds: z.number().default(30),
  flow_confirm_seconds: z.number().default(15),
  api_watchdog_seconds: z.number().default(300),
  flow_cal: z.number().default(450.0),
  update_interval: z.string().default("5s"),
});

export const ManifestSchema = z.object({
  schema: z.number().int().positive().optional(),
  device: DeviceSchema,
  pump: PumpSchema,
  tanks: z.array(TankSchema).min(1),
  valves: z.array(ValveSchema).min(1),
  flow_sensors: z.array(FlowSensorSchema).min(1),
  routes: z.array(RouteSchema).min(1),
  timing: TimingSchema.default({}),
});

export type Manifest = z.infer<typeof ManifestSchema>;
export type Tank = z.infer<typeof TankSchema>;
export type Valve = z.infer<typeof ValveSchema>;
export type FlowSensor = z.infer<typeof FlowSensorSchema>;
export type Route = z.infer<typeof RouteSchema>;
export type Timing = z.infer<typeof TimingSchema>;
