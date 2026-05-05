/**
 * TopologySchema — the single Zod schema for validating topology documents.
 *
 * Assembles the node discriminated union from NODE_REGISTRY, so adding a new
 * entity file is all that's needed — no manual wiring here.
 */
import { z } from 'zod';
import { NODE_REGISTRY } from './entity-registry';
import { DeviceSchema, TimingSchema, AutomationSchema, parseDurationMs } from './schemas';
import { buildGraph, deriveRoutes } from './graph/index';

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

export const RouteOverrideSchema = z.object({
  max_runtime_seconds: z.number().gt(1).optional(),
  source_min_level: z.number().min(0).max(100).optional(),
  dest_max_level: z.number().min(0).max(100).optional(),
});

// ---------------------------------------------------------------------------
// Topology (top-level document)
// ---------------------------------------------------------------------------

export const TopologySchema = z.object({
  schema: z.literal(13),
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

const PSI_PER_BAR = 14.5037738;

/**
 * Migrate legacy topology shape to current schema:
 * - Renames `flow_watchdog_seconds` etc. to current keys
 * - Converts string durations ("15s"/"2000ms") to numeric seconds
 * - Converts legacy pressure sensor `min_bar` / `max_bar` fields to the
 *   current psi-based model.
 */
function migrateLegacyTopology(data: unknown): unknown {
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
      if (node['kind'] === 'pressure_sensor') {
        const migrated = { ...node };
        if (migrated['sensor_max_psi'] == null && typeof migrated['max_bar'] === 'number') {
          migrated['sensor_max_psi'] = Number((migrated['max_bar'] * PSI_PER_BAR).toFixed(2));
          nodesChanged = true;
        }
        if ('min_bar' in migrated || 'max_bar' in migrated) {
          delete migrated['min_bar'];
          delete migrated['max_bar'];
          nodesChanged = true;
        }
        return migrated;
      }
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

// ---------------------------------------------------------------------------
// Schema-version migration chain
// ---------------------------------------------------------------------------

export const CURRENT_SCHEMA_VERSION = 13;

type SchemaMigration = (data: Record<string, unknown>) => Record<string, unknown>;

const SCHEMA_MIGRATIONS: Record<number, SchemaMigration> = {
  5: (data) => { data['schema'] = 6; data['automations'] = data['automations'] ?? []; return data; },
  6: (data) => {
    data['schema'] = 7;
    const overrides = (data['route_overrides'] ?? {}) as Record<string, Record<string, unknown>>;
    const automations = (data['automations'] ?? []) as Array<Record<string, unknown>>;
    for (const a of automations) {
      const cond = a['conditions'] as Record<string, unknown> | undefined;
      if (!cond) continue;
      const routeKey = a['route'] as string;
      if (!routeKey) continue;
      const ov = overrides[routeKey] ?? {};
      if (cond['source_min_level'] != null && ov['source_min_level'] == null) {
        ov['source_min_level'] = cond['source_min_level'];
      }
      if (cond['dest_max_level'] != null && ov['dest_max_level'] == null) {
        ov['dest_max_level'] = cond['dest_max_level'];
      }
      overrides[routeKey] = ov;
      delete a['conditions'];
    }
    data['route_overrides'] = overrides;
    return data;
  },
  7: (data) => { data['schema'] = 8; return data; },
  8: (data) => {
    data['schema'] = 9;
    const nodes = (data['nodes'] ?? []) as Array<Record<string, unknown>>;
    for (const n of nodes) if (n['kind'] === 'handoff') n['kind'] = 'interconnect';
    return data;
  },
  9: (data) => { data['schema'] = 10; return data; },
  10: (data) => {
    data['schema'] = 11;
    const nodes = (data['nodes'] ?? []) as Array<Record<string, unknown>>;
    for (const n of nodes) {
      if (n['kind'] === 'tank') {
        delete n['level_pin'];
        delete n['pump_rated'];
      }
    }
    return data;
  },
  11: (data) => {
    data['schema'] = 12;
    // Route keys gain a path-distinguishing valve suffix so parallel paths
    // between the same endpoints no longer collide. Rewrite saved references
    // (route_overrides keys, automations[].route) by running route derivation
    // against the saved graph and matching old "src>dst" entries to new keys.
    // Also drops the now-removed trigger.node and trigger.entity fields.
    const nodes = (data['nodes'] ?? []) as Array<{ id: string; kind: string; disabled?: boolean }>;
    const pipes = (data['pipes'] ?? []) as Array<{ from: string; to: string }>;

    const oldToNew = new Map<string, string[]>();
    try {
      const graph = buildGraph(nodes as never[], pipes as never[]);
      for (const route of deriveRoutes(graph)) {
        const oldKey = `${route.source}>${route.destination}`;
        const list = oldToNew.get(oldKey) ?? [];
        list.push(route.key);
        oldToNew.set(oldKey, list);
      }
    } catch (err) {
      console.warn(`schema 11→12 migration: graph build failed: ${(err as Error).message}`);
    }

    const pickNew = (oldKey: string, ctx: string): string | null => {
      const matches = oldToNew.get(oldKey);
      if (!matches || matches.length === 0) {
        console.warn(`schema 11→12: ${ctx} references unknown route "${oldKey}" — dropped`);
        return null;
      }
      if (matches.length > 1) {
        console.warn(`schema 11→12: ${ctx} key "${oldKey}" matches ${matches.length} parallel routes — bound to ${matches[0]}`);
      }
      return matches[0];
    };

    const overrides = (data['route_overrides'] ?? {}) as Record<string, unknown>;
    const newOverrides: Record<string, unknown> = {};
    for (const [oldKey, value] of Object.entries(overrides)) {
      if (oldKey.includes('#')) { newOverrides[oldKey] = value; continue; }
      const newKey = pickNew(oldKey, 'route_overrides');
      if (newKey) newOverrides[newKey] = value;
    }
    data['route_overrides'] = newOverrides;

    const automations = (data['automations'] ?? []) as Array<Record<string, unknown>>;
    for (const a of automations) {
      const oldKey = a['route'] as string | undefined;
      if (oldKey && !oldKey.includes('#')) {
        const newKey = pickNew(oldKey, `automation "${a['name'] ?? a['id'] ?? '?'}"`);
        if (newKey) a['route'] = newKey;
      }
      const trigger = a['trigger'] as Record<string, unknown> | undefined;
      if (trigger) {
        delete trigger['node'];
        delete trigger['entity'];
      }
    }
    return data;
  },
  12: (data) => {
    data['schema'] = 13;
    // Level triggers no longer carry an inline threshold — they fire on the
    // route's source_min_level, which firmware also uses as a safety floor.
    // Migrate any prior `above` value into source_min_level for the route
    // (if not already set), then strip below/above from the trigger.
    const overrides = (data['route_overrides'] ?? {}) as Record<string, Record<string, unknown>>;
    const automations = (data['automations'] ?? []) as Array<Record<string, unknown>>;
    for (const a of automations) {
      const trigger = a['trigger'] as Record<string, unknown> | undefined;
      if (!trigger || trigger['type'] !== 'level') continue;
      const above = trigger['above'];
      const routeKey = a['route'] as string | undefined;
      if (routeKey && typeof above === 'number') {
        const ov = overrides[routeKey] ?? {};
        if (ov['source_min_level'] == null) ov['source_min_level'] = above;
        overrides[routeKey] = ov;
      }
      delete trigger['below'];
      delete trigger['above'];
    }
    data['route_overrides'] = overrides;
    return data;
  },
};

/**
 * Apply the schema migration chain to a raw topology document. Idempotent —
 * data already at the current schema version passes through unchanged.
 * Returns the migrated data; the caller is responsible for parsing it.
 */
export function migrateTopology(data: unknown): unknown {
  if (!data || typeof data !== 'object') return data;
  let d = data as Record<string, unknown>;
  const versionOf = (obj: Record<string, unknown>, fallback: number): number => {
    const s = obj['schema'];
    return typeof s === 'number' ? s : fallback;
  };
  let v = versionOf(d, 0);
  while (SCHEMA_MIGRATIONS[v]) {
    d = SCHEMA_MIGRATIONS[v](d);
    v = versionOf(d, v + 1);
  }
  return d;
}

/**
 * Parse and validate a raw topology document.
 * Returns a properly typed SystemTopology — the Zod schema guarantees
 * the structure matches because entity schemas are the source of truth.
 * Applies schema-version migrations and legacy-key cleanup before validation.
 */
export function parseTopology(data: unknown): SystemTopology {
  return TopologySchema.parse(migrateLegacyTopology(migrateTopology(data))) as SystemTopology;
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
