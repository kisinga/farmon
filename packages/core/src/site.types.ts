/**
 * Site types — the composition layer that groups site-scoped systems
 * with inter-system links.
 *
 * Sites are the top-level workspace. Each system belongs to exactly one site.
 * Templates are read-only blueprints instantiated into site-scoped systems.
 */

// ---------------------------------------------------------------------------
// Site metadata
// ---------------------------------------------------------------------------

export interface SiteMetadata {
  id: string;
  friendlyName: string;
}

// ---------------------------------------------------------------------------
// Inter-system links (explicit fields, no string parsing)
// ---------------------------------------------------------------------------

export interface LinkData {
  id: string;
  fromSystem: string;
  fromNode: string;
  fromPort: string;
  toSystem: string;
  toNode: string;
  toPort: string;
  label?: string | null;
}

// ---------------------------------------------------------------------------
// Stored topology (the JSON blob in the systems table)
// ---------------------------------------------------------------------------

import type { TopologyNode, PipeSegment, RouteOverride, Automation, UartBus, IoProviderDef, NetworkConfig } from './topology.types';

export interface StoredTopology {
  nodes: TopologyNode[];
  pipes: PipeSegment[];
  route_overrides: Record<string, RouteOverride>;
  timing: {
    valve_travel_time: number;
    flow_watchdog: number;
    flow_confirm: number;
    api_watchdog: number;
    update_interval: number;
  };
  automations: Automation[];
  uart_buses?: UartBus[];
  io_providers?: IoProviderDef[];
  network?: NetworkConfig;
}

// ---------------------------------------------------------------------------
// IPC payloads
// ---------------------------------------------------------------------------

export interface SystemPayload {
  id: string;
  friendlyName: string;
  board: string;
  directory: string | null;
  topology: StoredTopology;
  deviceName: string;
}

export interface SiteFullPayload {
  site: SiteMetadata;
  systems: SystemPayload[];
  links: LinkData[];
}

export type SiteSavePayload = SiteFullPayload;

// ---------------------------------------------------------------------------
// List entries (for overview)
// ---------------------------------------------------------------------------

export interface SiteListEntry {
  id: string;
  friendlyName: string;
  systemCount: number;
  linkCount: number;
}

export interface TemplateListEntry {
  name: string;
  friendlyName: string;
  board: string;
  tanks: number;
  valves: number;
}
