import { z } from "zod";
import { DeviceSchema, TimingSchema } from "./shared-schema.js";

// Import schemas from entity files (source of truth)
import { TankNodeSchema } from "../../shared/entities/tank.js";
import { PumpNodeSchema } from "../../shared/entities/pump.js";
import { EndpointNodeSchema } from "../../shared/entities/endpoint.js";
import { ValveNodeSchema } from "../../shared/entities/valve.js";
import { FlowSensorNodeSchema } from "../../shared/entities/flow-sensor.js";
import { WaterSourceNodeSchema } from "../../shared/entities/water-source.js";
import { PressureSensorNodeSchema } from "../../shared/entities/pressure-sensor.js";
import { FilterNodeSchema } from "../../shared/entities/filter.js";
import { DosingPumpNodeSchema } from "../../shared/entities/dosing-pump.js";

// ---------------------------------------------------------------------------
// Node discriminated union — assembled from entity schemas
// ---------------------------------------------------------------------------

const TopologyNodeSchema = z.discriminatedUnion("kind", [
  TankNodeSchema,
  PumpNodeSchema,
  EndpointNodeSchema,
  ValveNodeSchema,
  FlowSensorNodeSchema,
  WaterSourceNodeSchema,
  PressureSensorNodeSchema,
  FilterNodeSchema,
  DosingPumpNodeSchema,
]);

// ---------------------------------------------------------------------------
// Pipes (edges between ports)
// ---------------------------------------------------------------------------

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
// Topology (top-level document) — Schema v5
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

export type TopologyNode = z.infer<typeof TopologyNodeSchema>;
export type PipeSegment = z.infer<typeof PipeSegmentSchema>;
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
