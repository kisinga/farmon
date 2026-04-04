import { z } from "zod";

// ---------------------------------------------------------------------------
// Shared primitives
// ---------------------------------------------------------------------------

const GpioPin = z.string().regex(/^GPIO\d{1,2}$/, "Must be GPIOnn format");
const Position = z.object({ x: z.number(), y: z.number() });

// ---------------------------------------------------------------------------
// Ports
// ---------------------------------------------------------------------------

const PortDirection = z.enum(["inlet", "outlet"]);

const PortSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  direction: PortDirection,
});

// ---------------------------------------------------------------------------
// Nodes
// ---------------------------------------------------------------------------

const TankNodeSchema = z.object({
  kind: z.literal("tank"),
  id: z.string().min(1),
  name: z.string().min(1),
  level_pin: GpioPin,
  ports: z.array(PortSchema).min(1),
  position: Position,
});

const PumpNodeSchema = z.object({
  kind: z.literal("pump"),
  id: z.string().min(1),
  pin: GpioPin,
  ports: z
    .array(PortSchema)
    .length(2)
    .refine(
      (ports) =>
        ports.filter((p) => p.direction === "inlet").length === 1 &&
        ports.filter((p) => p.direction === "outlet").length === 1,
      { message: "Pump must have exactly one inlet and one outlet port" }
    ),
  position: Position,
});

const EndpointNodeSchema = z.object({
  kind: z.literal("endpoint"),
  id: z.string().min(1),
  name: z.string().min(1),
  ports: z.array(PortSchema).min(1),
  position: Position,
});

const TopologyNodeSchema = z.discriminatedUnion("kind", [
  TankNodeSchema,
  PumpNodeSchema,
  EndpointNodeSchema,
]);

// ---------------------------------------------------------------------------
// Inline components (live on pipes)
// ---------------------------------------------------------------------------

const ValveComponentSchema = z.object({
  kind: z.literal("valve"),
  id: z.string().min(1),
  name: z.string().min(1),
  open_pin: GpioPin,
  close_pin: GpioPin,
});

const FlowComponentSchema = z.object({
  kind: z.literal("flow_sensor"),
  id: z.string().min(1),
  name: z.string().min(1),
  pin: GpioPin,
  flow_cal: z.number().default(450.0),
});

const InlineComponentSchema = z.discriminatedUnion("kind", [
  ValveComponentSchema,
  FlowComponentSchema,
]);

// ---------------------------------------------------------------------------
// Pipes (edges between ports)
// ---------------------------------------------------------------------------

// Port references use "nodeId:portId" format
const PortRef = z.string().regex(/^[^:]+:[^:]+$/, 'Must be "nodeId:portId" format');

const PipeSegmentSchema = z.object({
  id: z.string().min(1),
  from: PortRef,
  to: PortRef,
  components: z.array(InlineComponentSchema).default([]),
});

// ---------------------------------------------------------------------------
// Route overrides
// ---------------------------------------------------------------------------

const RouteOverrideSchema = z.object({
  name: z.string().optional(),
  max_runtime_seconds: z.number().optional(),
});

// ---------------------------------------------------------------------------
// Device & Timing (shared with manifest schema)
// ---------------------------------------------------------------------------

const DeviceSchema = z.object({
  name: z.string().min(1),
  friendly_name: z.string().min(1),
  board: z.string().min(1),
  directory: z.string().optional(),
});

const TimingSchema = z.object({
  valve_travel_time: z.string().default("15s"),
  flow_watchdog_seconds: z.number().default(30),
  flow_confirm_seconds: z.number().default(15),
  api_watchdog_seconds: z.number().default(300),
  update_interval: z.string().default("5s"),
});

// ---------------------------------------------------------------------------
// Topology (top-level document)
// ---------------------------------------------------------------------------

export const TopologySchema = z.object({
  schema: z.literal(3),
  device: DeviceSchema,
  nodes: z.array(TopologyNodeSchema).min(1),
  pipes: z.array(PipeSegmentSchema).default([]),
  route_overrides: z.record(z.string(), RouteOverrideSchema).default({}),
  timing: TimingSchema.default({}),
});

// ---------------------------------------------------------------------------
// Exported types
// ---------------------------------------------------------------------------

export type Port = z.infer<typeof PortSchema>;
export type TankNode = z.infer<typeof TankNodeSchema>;
export type PumpNode = z.infer<typeof PumpNodeSchema>;
export type EndpointNode = z.infer<typeof EndpointNodeSchema>;
export type TopologyNode = z.infer<typeof TopologyNodeSchema>;
export type ValveComponent = z.infer<typeof ValveComponentSchema>;
export type FlowComponent = z.infer<typeof FlowComponentSchema>;
export type InlineComponent = z.infer<typeof InlineComponentSchema>;
export type PipeSegment = z.infer<typeof PipeSegmentSchema>;
export type RouteOverride = z.infer<typeof RouteOverrideSchema>;
export type Topology = z.infer<typeof TopologySchema>;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Parse a "nodeId:portId" reference into its parts. */
export function parsePortRef(ref: string): { nodeId: string; portId: string } {
  const [nodeId, portId] = ref.split(":");
  return { nodeId, portId };
}

/** Build a "nodeId:portId" reference. */
export function portRef(nodeId: string, portId: string): string {
  return `${nodeId}:${portId}`;
}
