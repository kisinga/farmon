/**
 * TopologySchema — the single Zod schema for validating topology documents.
 *
 * Assembles the node discriminated union from NODE_REGISTRY, so adding a new
 * entity file is all that's needed — no manual wiring here.
 */
import { z } from 'zod';
import { NODE_REGISTRY } from './entity-registry';
import { DeviceSchema, TimingSchema, AutomationSchema, parseDurationMs } from './schemas';

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
  max_runtime_seconds: z.number().gt(1).optional(),
  source_min_level: z.number().min(0).max(100).optional(),
  dest_max_level: z.number().min(0).max(100).optional(),
});

// ---------------------------------------------------------------------------
// Topology (top-level document)
// ---------------------------------------------------------------------------

export const TopologySchema = z.object({
  schema: z.literal(11),
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
 * Migrate legacy topology shape to current schema:
 * - Renames `flow_watchdog_seconds` etc. to current keys
 * - Converts string durations ("15s"/"2000ms") to numeric seconds
 */
function migrateTiming(data: unknown): unknown {
  if (!data || typeof data !== 'object') return data;
  const d = data as Record<string, unknown>;
  let changed = false;

  // --- Timing block ---
  const timing = d['timing'] as Record<string, unknown> | undefined;
  let migratedTiming = timing;
  if (timing && typeof timing === 'object') {
    const t = { ...timing };
    const renames: Array<[string, string]> = [
      ['flow_watchdog_seconds', 'flow_watchdog'],
      ['flow_confirm_seconds', 'flow_confirm'],
      ['api_watchdog_seconds', 'api_watchdog'],
    ];
    for (const [oldKey, newKey] of renames) {
      if (oldKey in t && !(newKey in t)) {
        t[newKey] = t[oldKey];
        delete t[oldKey];
        changed = true;
      }
    }
    // String-duration → seconds
    for (const key of ['valve_travel_time', 'update_interval']) {
      const v = t[key];
      if (typeof v === 'string') {
        t[key] = Math.round(parseDurationMs(v) / 1000);
        changed = true;
      }
    }
    migratedTiming = t;
  }

  // --- Valve nodes' travel_time (string → seconds) ---
  const nodes = d['nodes'];
  let migratedNodes = nodes;
  if (Array.isArray(nodes)) {
    let nodesChanged = false;
    const n = nodes.map((raw) => {
      if (!raw || typeof raw !== 'object') return raw;
      const node = raw as Record<string, unknown>;
      if (node['kind'] === 'valve' && typeof node['travel_time'] === 'string') {
        nodesChanged = true;
        return { ...node, travel_time: Math.round(parseDurationMs(node['travel_time'] as string) / 1000) };
      }
      return node;
    });
    if (nodesChanged) {
      migratedNodes = n;
      changed = true;
    }
  }

  return changed ? { ...d, timing: migratedTiming, nodes: migratedNodes } : data;
}

/**
 * Parse and validate a raw topology document.
 * Returns a properly typed SystemTopology — the Zod schema guarantees
 * the structure matches because entity schemas are the source of truth.
 * Applies legacy-key migration before validation.
 */
export function parseTopology(data: unknown): SystemTopology {
  return TopologySchema.parse(migrateTiming(data)) as SystemTopology;
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
