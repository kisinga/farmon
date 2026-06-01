import type { SiteTopology, TopologyNode, NetworkConfig, UartBus, IoProviderDef } from './topology.types';
import type { TankLevelSource } from './tank-level';

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

/** Device and Timing types — single source of truth. */
export type Device = {
  name: string;
  friendly_name: string;
  board: string;
  directory?: string;
  network?: NetworkConfig;
  uart_buses?: UartBus[];
  io_providers?: IoProviderDef[];
};
export type Timing = SiteTopology['timing'];

/** Local topology node with manifest-only extensions. */
export type LocalManifestNode = TopologyNode & {
  /** HA entity_id for remote reads — set when this node's primary value lives on another controller (e.g. tank with remote level source). */
  remoteHaEntityId?: string;
  remoteDeviceName?: string;
  /** Resolved level source for tank nodes. */
  level_source?: TankLevelSource;
  /** Allow dynamic field access for sidebar field iteration. */
  [key: string]: unknown;
};

/** Imported node — anchored to another controller, proxied locally. */
export type ImportedManifestNode = TopologyNode & {
  /** HA entity_id of the canonical entity on the owning controller. */
  remoteHaEntityId: string;
  /** Slug of the controller that owns this node. */
  remoteDeviceName: string;
  /** Allow dynamic field access for sidebar field iteration. */
  [key: string]: unknown;
};

/** Union type for consumers that need to handle both local and imported nodes. */
export type ManifestNode = LocalManifestNode | ImportedManifestNode;


export interface ManifestAutomation {
  id: string;
  name: string;
  route_index: number;      // resolved index into routes[]
  route_key: string;        // original key for display
  route_name: string;       // human-readable route name
  trigger: { type: 'time'; at: string } | { type: 'level'; for_minutes?: number };
  days_of_week: string[];
  enabled: boolean;
}

export interface Manifest {
  /** The controller ID this manifest was built for (set by topologyToManifestForController). */
  controllerId?: string;
  device: Device;
  /** Local nodes — generate hardware on this controller. */
  nodes: LocalManifestNode[];
  /** Imported nodes — proxied from other controllers. */
  imports: ImportedManifestNode[];
  routes: Route[];
  timing: Timing;
  automations: ManifestAutomation[];
}

export interface Route {
  key: string;             // stable ID: "sourceId>destId#valve1+valve2" — see graph/routes.ts
  name: string;
  source: string;
  source_type: 'tank' | 'water_source';
  destination?: string;
  valves: string[];
  /** Primary flow sensor for this route. Undefined for unmonitored routes (no flow watchdog). */
  flow_sensor?: string;
  max_runtime_seconds: number;
  /** Whether this route crosses a pump. */
  crossesPump: boolean;
  /** Index of the pump in nodeSequence, or -1 if `crossesPump` is false. */
  pumpIndex: number;
  /** Ordered node IDs from source to destination (inclusive). */
  nodeSequence: string[];
  /** Firmware pre-start: reject if source tank below this %. 0 = no check. */
  source_min_pct: number;
  /** Firmware pre-start: reject if dest tank above this %. 0 = no check. */
  dest_max_pct: number;
  /**
   * True when the source endpoint is a tank with a resolvable level source.
   * Drives whether the firmware emits a runtime-tunable Source Min number
   * entity for this route.
   */
  source_has_level: boolean;
  /**
   * True when the destination endpoint is a tank with a resolvable level
   * source. Drives whether the firmware emits a runtime-tunable Dest Max
   * number entity for this route.
   */
  dest_has_level: boolean;
  /** True if level sensors on this route are reliable during pump operation. */
  runtime_level_ok: boolean;
  /**
   * Pressure-sensor IDs that lie on this route's path (in traversal order).
   * Derived metadata — exposed for downstream consumers (HA dashboards, site
   * docs) that want to surface "this route involves these sensors". Firmware
   * does not consume this list.
   */
  inline_pressure_sensors: string[];
  /** True when this route has a flow sensor and participates in flow watchdog/confirm. */
  monitored: boolean;
}

// ---------------------------------------------------------------------------
// Helpers for typed access in generators
// ---------------------------------------------------------------------------

/**
 * Filter manifest nodes by kind with type narrowing.
 * Works with any node array (local, imported, or mixed).
 */
export function nodesByKind<K extends TopologyNode['kind'], T extends { kind: string }>(
  nodes: T[],
  kind: K,
): Extract<T, { kind: K }>[] {
  return nodes.filter((n): n is Extract<T, { kind: K }> => n.kind === kind);
}
