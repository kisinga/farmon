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

import type { TopologyNode, PipeSegment, RouteOverride, Automation, UartBus, NetworkConfig } from './topology.types';

export interface StoredTopology {
  nodes: TopologyNode[];
  pipes: PipeSegment[];
  route_overrides: Record<string, RouteOverride>;
  timing: {
    valve_travel_time: string;
    flow_watchdog_seconds: number;
    flow_confirm_seconds: number;
    api_watchdog_seconds: number;
    update_interval: string;
  };
  automations: Automation[];
  uart_buses?: UartBus[];
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
