import type { SystemTopology } from './topology.types';

// ---------------------------------------------------------------------------
// Manifest — internal intermediate representation
// ---------------------------------------------------------------------------
// This is the flat, normalized form derived from a Topology by
// topologyToManifest(). It is never saved to disk or shown to users.
// All code generators and validation consume this shape.
//
// Nodes are stored in a single generic array. Generators use
// nodesByKind() to filter and type-narrow. Adding a new node kind
// requires zero changes here.
// ---------------------------------------------------------------------------

/** Device and Timing types derived from SystemTopology (single source of truth). */
export type Device = SystemTopology['device'];
export type Timing = SystemTopology['timing'];

/** A topology node with layout fields stripped. */
export type ManifestNode = Record<string, any> & {
  kind: string;
  id: string;
};

export interface ManifestAutomation {
  id: string;
  name: string;
  route_index: number;      // resolved index into routes[]
  route_key: string;        // original key for display
  route_name: string;       // human-readable route name
  trigger: { type: 'time'; at: string } | { type: 'level'; node?: string; entity?: string; below?: number; above?: number; for_minutes?: number };
  days_of_week: string[];
  enabled: boolean;
}

export interface Manifest {
  device: Device;
  nodes: ManifestNode[];
  routes: Route[];
  timing: Timing;
  automations: ManifestAutomation[];
}

export interface Route {
  key: string;             // stable ID: "sourceId>destId" (matches DerivedRoute.key)
  name: string;
  source: string;
  source_type: 'tank' | 'water_source';
  destination?: string;
  valves: string[];
  flow_sensor: string;
  max_runtime_seconds: number;
  needs_pump: boolean;
  /** Ordered node IDs from source to destination (inclusive). */
  nodeSequence: string[];
  /** Firmware pre-start: reject if source tank below this %. 0 = no check. */
  source_min_pct: number;
  /** Firmware pre-start: reject if dest tank above this %. 0 = no check. */
  dest_max_pct: number;
  /** True if level sensors on this route are reliable during pump operation. */
  runtime_level_ok: boolean;
}

// ---------------------------------------------------------------------------
// Helpers for typed access in generators
// ---------------------------------------------------------------------------

/**
 * Filter manifest nodes by kind with type narrowing.
 * Returns nodes whose `kind` matches, cast to the inferred type.
 */
export function nodesByKind<K extends string>(
  nodes: ManifestNode[],
  kind: K,
): ManifestNode[] {
  return nodes.filter(n => n.kind === kind);
}
