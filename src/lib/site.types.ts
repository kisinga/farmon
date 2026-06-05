/**
 * Site types — the top-level workspace for Anchor Mesh.
 *
 * A site is one continuous water graph. Nodes are anchored to controllers.
 * Routes are derived per-controller from the site topology.
 */

// ---------------------------------------------------------------------------
// Site metadata
// ---------------------------------------------------------------------------

/**
 * Per-site deployment choice: which MQTT broker the site's controllers connect
 * to. `managed` = the MajiFlow cloud (broker autofilled, fields blank here);
 * `local` = an on-site box (installer sets the broker address). Drives the
 * cross-controller (cross-talk) rule: managed forbids it, local allows it.
 */
export interface SiteDeployment {
  mode: 'managed' | 'local';
  /** Broker host for a local site; blank for managed (autofilled from cloud). */
  brokerHost: string;
  /** Broker port; 0 means "use the cloud default". */
  brokerPort: number;
  brokerTls: boolean;
}

export interface SiteMetadata {
  id: string;
  friendlyName: string;
  /** Undefined until the installer picks Online/Local for the site. */
  deployment?: SiteDeployment;
  /**
   * Owning user id (a plain string — no auth coupling). Populated on load so the
   * dashboard can tell an owner apart from an admin viewing someone else's site
   * (read-only + "Take control"). Not written back on save (set at create).
   */
  owner?: string;
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
