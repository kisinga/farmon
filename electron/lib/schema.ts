import type { Device, Timing } from "./shared-schema.js";

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

/** A topology node with layout fields stripped. */
export type ManifestNode = Record<string, any> & {
  kind: string;
  id: string;
};

export interface Manifest {
  device: Device;
  nodes: ManifestNode[];
  routes: Route[];
  timing: Timing;
}

export interface Route {
  name: string;
  source: string;
  source_type: 'tank' | 'water_source';
  destination?: string;
  valves: string[];
  flow_sensor: string;
  max_runtime_seconds: number;
  needs_pump: boolean;
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

// Re-export shared types for convenience
export type { Device, Timing };
