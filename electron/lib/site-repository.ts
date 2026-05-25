/**
 * SiteRepository — composed read/write layer for site topologies.
 *
 * Composes three primitives:
 *   EventStore     → append / list / delete topology events
 *   SiteProjection → in-memory Map<siteId, SiteTopology> cache
 *   diffTopology   → computes events from two topologies
 *
 * The event log is the single source of truth. This module never touches
 * sites.topology (that column is dropped in v11).
 */

import type { SiteTopology, SiteListEntry, TopologyEvent } from "@far-mon/core";
import { parseTopology } from "@far-mon/core";
import { reconstructTopology } from "./reconstruct-topology.js";
import { diffTopology } from "./topology-diff.js";
import * as EventStore from "./event-store.js";
import { queryAll, queryOne, getDb, persist } from "../db.js";

// ---------------------------------------------------------------------------
// Projection cache
// ---------------------------------------------------------------------------

const projections = new Map<string, SiteTopology>();

function getCached(siteId: string): SiteTopology | undefined {
  return projections.get(siteId);
}

function setCached(siteId: string, topology: SiteTopology): void {
  projections.set(siteId, structuredClone(topology));
}

function deleteCached(siteId: string): void {
  projections.delete(siteId);
}

// ---------------------------------------------------------------------------
// Init — eager load all sites into projection cache on startup
// ---------------------------------------------------------------------------

export async function init(): Promise<void> {
  const sites = queryAll<{ id: string }>("SELECT id FROM sites ORDER BY friendly_name");
  for (const site of sites) {
    const events = EventStore.listEvents(site.id);
    if (events.length === 0) {
      // No events yet — empty site
      projections.set(site.id, emptyTopology());
      continue;
    }
    const topology = reconstructTopology(events, Infinity);
    projections.set(site.id, topology);
  }
}

// ---------------------------------------------------------------------------
// Core operations
// ---------------------------------------------------------------------------

/** Load a site's current topology. Uses projection cache; reconstructs on miss. */
export function load(siteId: string): SiteTopology {
  const cached = getCached(siteId);
  if (cached) return structuredClone(cached);

  const events = EventStore.listEvents(siteId);
  if (events.length === 0) {
    return emptyTopology();
  }
  const topology = reconstructTopology(events, Infinity);
  setCached(siteId, topology);
  return structuredClone(topology);
}

/** Load site metadata + topology (the shape the frontend expects). */
export function loadFull(siteId: string): { site: { id: string; friendlyName: string }; topology: SiteTopology } | null {
  const row = queryOne<{ id: string; friendly_name: string }>(
    "SELECT id, friendly_name FROM sites WHERE id = ?", [siteId],
  );
  if (!row) return null;
  return {
    site: { id: row.id, friendlyName: row.friendly_name },
    topology: load(siteId),
  };
}

/** Save a topology, diffing against the current projection and appending events. */
export function save(siteId: string, topology: SiteTopology): TopologyEvent[] {
  const current = getCached(siteId) ?? load(siteId);
  const events = diffTopology(current, topology);
  if (events.length > 0) {
    EventStore.appendEvents(siteId, events);
    setCached(siteId, topology);
  }
  return events;
}

// ---------------------------------------------------------------------------
// Site metadata operations
// ---------------------------------------------------------------------------

export function list(): SiteListEntry[] {
  const rows = queryAll<{ id: string; friendly_name: string }>(
    "SELECT id, friendly_name FROM sites ORDER BY friendly_name",
  );
  return rows.map((row) => {
    const topology = getCached(row.id);
    return {
      id: row.id,
      friendlyName: row.friendly_name,
      controllerCount: topology?.controllers.length ?? 0,
      nodeCount: topology?.nodes.length ?? 0,
    };
  });
}

export function create(id: string, friendlyName: string): void {
  getDb().run(
    "INSERT INTO sites (id, friendly_name) VALUES (?, ?)",
    [id, friendlyName],
  );
  persist();

  const topology = emptyTopology();
  EventStore.appendEvents(id, [{
    actor: "system",
    eventType: "snapshot",
    payload: { topology },
  }]);
  setCached(id, topology);
}

export function rename(id: string, friendlyName: string): void {
  getDb().run(
    "UPDATE sites SET friendly_name = ? WHERE id = ?",
    [friendlyName, id],
  );
  persist();
}

export function deleteSite(id: string): void {
  getDb().run("DELETE FROM sites WHERE id = ?", [id]);
  persist();
  EventStore.deleteEvents(id);
  deleteCached(id);
}

export function duplicate(sourceId: string, newId: string, newFriendlyName: string): void {
  const sourceTopology = load(sourceId);
  const db = getDb();
  db.run("BEGIN TRANSACTION");
  try {
    db.run(
      "INSERT INTO sites (id, friendly_name) VALUES (?, ?)",
      [newId, newFriendlyName],
    );

    // Copy HA files
    const haFiles = queryAll<{ filename: string; content: string }>(
      "SELECT filename, content FROM ha_files WHERE site_id = ?", [sourceId],
    );
    for (const hf of haFiles) {
      db.run(
        "INSERT INTO ha_files (site_id, filename, content) VALUES (?, ?, ?)",
        [newId, hf.filename, hf.content],
      );
    }

    // Copy controller secrets
    const secrets = queryAll<{ system_id: string; key: string; value: string }>(
      "SELECT system_id, key, value FROM system_secrets WHERE site_id = ?", [sourceId],
    );
    for (const s of secrets) {
      db.run(
        "INSERT INTO system_secrets (site_id, system_id, key, value) VALUES (?, ?, ?, ?)",
        [newId, s.system_id, s.key, s.value],
      );
    }

    // Copy controller settings
    const settings = queryAll<{ system_id: string; key: string; value: string }>(
      "SELECT system_id, key, value FROM system_settings WHERE site_id = ?", [sourceId],
    );
    for (const s of settings) {
      db.run(
        "INSERT INTO system_settings (site_id, system_id, key, value) VALUES (?, ?, ?, ?)",
        [newId, s.system_id, s.key, s.value],
      );
    }

    db.run("COMMIT");
    persist();
  } catch (e) {
    db.run("ROLLBACK");
    throw e;
  }

  EventStore.appendEvents(newId, [{
    actor: "system",
    eventType: "snapshot",
    payload: { topology: structuredClone(sourceTopology) },
  }]);
  setCached(newId, structuredClone(sourceTopology));
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function emptyTopology(): SiteTopology {
  return parseTopology({
    schema: 16,
    controllers: [],
    nodes: [],
    pipes: [],
    route_overrides: {},
    timing: {
      valve_travel_time: 15,
      flow_watchdog: 30,
      flow_confirm: 10,
      flow_threshold: 0.5,
      api_watchdog: 60,
      update_interval: 30,
    },
    automations: [],
    remoteImports: [],
  });
}

// ---------------------------------------------------------------------------
// Controller mutations
// ---------------------------------------------------------------------------

export function addController(
  siteId: string,
  controller: import("@far-mon/core").Controller,
  controllerTopology: {
    nodes?: import("@far-mon/core").TopologyNode[];
    pipes?: import("@far-mon/core").PipeSegment[];
    route_overrides?: Record<string, import("@far-mon/core").RouteOverride>;
    timing?: Partial<SiteTopology["timing"]>;
    automations?: import("@far-mon/core").Automation[];
  },
): void {
  const topology = load(siteId);

  topology.controllers.push(controller);

  const incomingNodes = (controllerTopology.nodes ?? []).map((n) => ({
    ...n,
    anchorId: controller.id,
  }));
  topology.nodes.push(...incomingNodes);
  topology.pipes.push(...(controllerTopology.pipes ?? []));

  topology.route_overrides = {
    ...topology.route_overrides,
    ...(controllerTopology.route_overrides ?? {}),
  };

  if (controllerTopology.timing) {
    topology.timing = { ...topology.timing, ...controllerTopology.timing };
  }

  topology.automations.push(...(controllerTopology.automations ?? []));

  save(siteId, topology);
}

/**
 * Check for node ID conflicts within a site.
 * In the anchor-mesh model, node IDs are site-scoped.
 * Returns node IDs that already exist in the site topology.
 */
export function checkNodeIdConflicts(
  siteId: string, _excludeSystemId: string, nodeIds: string[],
): string[] {
  if (nodeIds.length === 0) return [];
  const existing = new Set(load(siteId).nodes.map(n => n.id));
  return nodeIds.filter(id => existing.has(id));
}

export function removeController(siteId: string, controllerId: string): void {
  const topology = load(siteId);

  // Collect node IDs anchored to this controller
  const removedNodeIds = new Set(
    topology.nodes
      .filter((n) => (n as unknown as { anchorId?: string }).anchorId === controllerId)
      .map((n) => n.id),
  );

  topology.controllers = topology.controllers.filter((c) => c.id !== controllerId);
  topology.nodes = topology.nodes.filter(
    (n) => (n as unknown as { anchorId?: string }).anchorId !== controllerId,
  );
  topology.pipes = topology.pipes.filter((p) => {
    const fromNode = p.from.split(":")[0];
    const toNode = p.to.split(":")[0];
    return !removedNodeIds.has(fromNode) && !removedNodeIds.has(toNode);
  });

  topology.route_overrides = Object.fromEntries(
    Object.entries(topology.route_overrides).filter(([key]) => !removedNodeIds.has(key)),
  );

  topology.automations = topology.automations.filter((a) => {
    if (a.route && removedNodeIds.has(a.route)) return false;
    return true;
  });

  save(siteId, topology);
}
