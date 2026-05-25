/**
 * EventStore — typed append-only event log for topology mutations.
 *
 * Thin wrapper around the topology_events SQL table.
 * Validates every payload with Zod on read.
 */

import type { TopologyEvent } from "@far-mon/core";
import { parseTopologyEvent } from "@far-mon/core";
import type { TopologyEventRecord } from "./reconstruct-topology.js";
import { getDb, queryAll, queryOne, persist } from "../db.js";

export interface EventRow {
  id: number;
  siteId: string;
  timestamp: string;
  actor: string | null;
  eventType: string;
  payload: string;
}

/** Append events to a site's log. */
export function appendEvents(siteId: string, events: TopologyEvent[]): void {
  const db = getDb();
  for (const ev of events) {
    db.run(
      `INSERT INTO topology_events (site_id, actor, event_type, payload)
       VALUES (?, ?, ?, ?)`,
      [siteId, ev.actor, ev.eventType, JSON.stringify(ev.payload)],
    );
  }
  persist();
}

/** Read all events for a site in ascending order (oldest first), validating payloads. */
export function listEvents(siteId: string): TopologyEventRecord[] {
  const rows = queryAll<{
    id: number;
    site_id: string;
    timestamp: string;
    actor: string | null;
    event_type: string;
    payload: string;
  }>(
    `SELECT id, site_id, timestamp, actor, event_type, payload
     FROM topology_events
     WHERE site_id = ?
     ORDER BY id ASC`,
    [siteId],
  );

  return rows.map((r) => {
    const parsed = JSON.parse(r.payload);
    const event = parseTopologyEvent({
      eventType: r.event_type,
      payload: parsed,
      actor: r.actor ?? "system",
    });
    return {
      ...event,
      id: r.id,
      siteId: r.site_id,
      timestamp: r.timestamp,
    };
  });
}

/** Delete every event for a site. Used by site deletion. */
export function deleteEvents(siteId: string): void {
  getDb().run("DELETE FROM topology_events WHERE site_id = ?", [siteId]);
  persist();
}

/** Count events for a site. */
export function eventCount(siteId: string): number {
  const row = queryOne<{ count: number }>(
    `SELECT COUNT(*) as count FROM topology_events WHERE site_id = ?`,
    [siteId],
  );
  return row?.count ?? 0;
}

/** Read events in descending order (newest first), with optional limit. */
export function listEventsDesc(siteId: string, limit?: number): TopologyEventRecord[] {
  const sql = limit
    ? `SELECT id, site_id, timestamp, actor, event_type, payload FROM topology_events WHERE site_id = ? ORDER BY id DESC LIMIT ?`
    : `SELECT id, site_id, timestamp, actor, event_type, payload FROM topology_events WHERE site_id = ? ORDER BY id DESC`;
  const params = limit ? [siteId, limit] : [siteId];
  const rows = queryAll<{
    id: number;
    site_id: string;
    timestamp: string;
    actor: string | null;
    event_type: string;
    payload: string;
  }>(sql, params);

  return rows.map((r) => {
    const parsed = JSON.parse(r.payload);
    const event = parseTopologyEvent({
      eventType: r.event_type,
      payload: parsed,
      actor: r.actor ?? "system",
    });
    return {
      ...event,
      id: r.id,
      siteId: r.site_id,
      timestamp: r.timestamp,
    };
  });
}
