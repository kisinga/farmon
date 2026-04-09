/**
 * TopologySchema — the single Zod schema for validating topology documents.
 *
 * Assembles the node discriminated union from NODE_REGISTRY, so adding a new
 * entity file is all that's needed — no manual wiring here.
 */
import { z } from 'zod';
import { NODE_REGISTRY } from './entity-registry';
import { DeviceSchema, TimingSchema, AutomationSchema } from './schemas';

// Side-effect: ensure all entities are registered before we read the registry.
import './entities';

// ---------------------------------------------------------------------------
// Node discriminated union — driven by the registry
// ---------------------------------------------------------------------------

const entitySchemas = [...NODE_REGISTRY.values()].map(d => d.schema);
const TopologyNodeSchema = z.discriminatedUnion(
  "kind",
  entitySchemas as [z.ZodObject<any>, z.ZodObject<any>, ...z.ZodObject<any>[]],
);

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
  max_runtime_seconds: z.number().optional(),
  source_min_level: z.number().min(0).max(100).optional(),
  dest_max_level: z.number().min(0).max(100).optional(),
});

// ---------------------------------------------------------------------------
// Topology (top-level document)
// ---------------------------------------------------------------------------

export const TopologySchema = z.object({
  schema: z.literal(8),
  device: DeviceSchema,
  nodes: z.array(TopologyNodeSchema).min(1),
  pipes: z.array(PipeSegmentSchema).default([]),
  route_overrides: z.record(z.string(), RouteOverrideSchema).default({}),
  timing: TimingSchema.default({}),
  automations: z.array(AutomationSchema).default([]),
});

// ---------------------------------------------------------------------------
// Exported types & typed parse
// ---------------------------------------------------------------------------

import type { SystemTopology } from './topology.types';

/** Raw Zod-inferred type (loose due to registry-driven union). */
export type Topology = z.infer<typeof TopologySchema>;

/**
 * Parse and validate a raw topology document.
 * Returns a properly typed SystemTopology — the Zod schema guarantees
 * the structure matches because entity schemas are the source of truth.
 */
export function parseTopology(data: unknown): SystemTopology {
  return TopologySchema.parse(data) as SystemTopology;
}

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
