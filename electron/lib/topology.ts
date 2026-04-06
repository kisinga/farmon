import { z } from "zod";
import { GpioPin, DeviceSchema, TimingSchema } from "./shared-schema.js";

// ---------------------------------------------------------------------------
// Shared primitives
// ---------------------------------------------------------------------------

const Position = z.object({ x: z.number(), y: z.number() });

/** Valid ESPHome/C++ identifier: lowercase letters, digits, underscores. */
const ComponentId = z.string().regex(
  /^[a-z][a-z0-9_]*$/,
  "Must be a valid identifier (lowercase letters, digits, underscores; must start with a letter)"
);

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
  id: ComponentId,
  name: z.string().min(1),
  level_pin: GpioPin.optional(),
  ports: z.array(PortSchema).min(1),
  position: Position,
});

const PumpNodeSchema = z.object({
  kind: z.literal("pump"),
  id: ComponentId,
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
  id: ComponentId,
  name: z.string().min(1),
  ports: z.array(PortSchema).min(1),
  position: Position,
});

const ValveNodeSchema = z.object({
  kind: z.literal("valve"),
  id: ComponentId,
  name: z.string().min(1),
  open_pin: GpioPin,
  close_pin: GpioPin,
  ports: z.array(PortSchema).min(1),
  position: Position,
});

const FlowSensorNodeSchema = z.object({
  kind: z.literal("flow_sensor"),
  id: ComponentId,
  name: z.string().min(1),
  pin: GpioPin,
  flow_cal: z.number().default(450.0),
  ports: z.array(PortSchema).min(1),
  position: Position,
});

const WaterSourceNodeSchema = z.object({
  kind: z.literal("water_source"),
  id: ComponentId,
  name: z.string().min(1),
  pressure_pin: GpioPin.optional(),
  ports: z.array(PortSchema).min(1),
  position: Position,
});

const TopologyNodeSchema = z.discriminatedUnion("kind", [
  TankNodeSchema,
  PumpNodeSchema,
  EndpointNodeSchema,
  ValveNodeSchema,
  FlowSensorNodeSchema,
  WaterSourceNodeSchema,
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
});

// ---------------------------------------------------------------------------
// Route overrides
// ---------------------------------------------------------------------------

const RouteOverrideSchema = z.object({
  name: z.string().optional(),
  max_runtime_seconds: z.number().optional(),
});

// ---------------------------------------------------------------------------
// Topology (top-level document) — Schema v4
// ---------------------------------------------------------------------------

export const TopologySchema = z.object({
  schema: z.literal(5),
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
export type ValveNode = z.infer<typeof ValveNodeSchema>;
export type FlowSensorNode = z.infer<typeof FlowSensorNodeSchema>;
export type WaterSourceNode = z.infer<typeof WaterSourceNodeSchema>;
export type TopologyNode = z.infer<typeof TopologyNodeSchema>;
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
