/**
 * Site types — the top-level workspace for Anchor Mesh.
 *
 * A site is one continuous water graph. Nodes are anchored to controllers.
 * Routes are derived per-controller from the site topology.
 */

// ---------------------------------------------------------------------------
// Site metadata
// ---------------------------------------------------------------------------

export interface SiteMetadata {
  id: string;
  friendlyName: string;
}

// ---------------------------------------------------------------------------
// Stored site topology (the JSON blob on disk)
// ---------------------------------------------------------------------------

import type { TopologyNode, PipeSegment, RouteOverride, Automation, UartBus, IoProviderDef, NetworkConfig, Controller } from './topology.types';

export interface StoredSiteTopology {
  schema: number;
  controllers: Controller[];
  nodes: TopologyNode[];
  pipes: PipeSegment[];
  route_overrides: Record<string, RouteOverride>;
  timing: {
    valve_travel_time: number;
    flow_watchdog: number;
    flow_confirm: number;
    flow_threshold: number;
    api_watchdog: number;
    update_interval: number;
  };
  automations: Automation[];
}

// ---------------------------------------------------------------------------
// IPC payloads
// ---------------------------------------------------------------------------

export interface SiteFullPayload {
  site: SiteMetadata;
  topology: StoredSiteTopology | null;
}

export type SiteSavePayload = {
  site: SiteMetadata;
  topology: StoredSiteTopology;
};

// ---------------------------------------------------------------------------
// List entries (for overview)
// ---------------------------------------------------------------------------

export interface SiteListEntry {
  id: string;
  friendlyName: string;
  controllerCount: number;
  nodeCount: number;
}

export interface TemplateListEntry {
  name: string;
  friendlyName: string;
  board: string;
  tanks: number;
  valves: number;
}
