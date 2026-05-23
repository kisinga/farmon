import initSqlJs, { type Database } from "sql.js";
import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

import type { SiteListEntry } from '@far-mon/core';

export interface SystemListEntry {
  id: string;
  friendlyName: string;
  board: string;
  nodeCount: number;
}

export interface LinkRow {
  id: string;
  siteId: string;
  fromSystem: string;
  fromNode: string;
  fromPort: string;
  toSystem: string;
  toNode: string;
  toPort: string;
  label: string | null;
}

export interface SystemRow {
  id: string;
  siteId: string;
  friendlyName: string;
  board: string;
  directory: string | null;
  topology: string; // JSON
  deviceName: string;
  sortOrder: number;
}

export interface SiteFullPayload {
  site: { id: string; friendlyName: string };
  topology: unknown; // parsed SiteTopology JSON
}

export interface SiteSavePayload {
  site: { id: string; friendlyName: string };
  topology: unknown; // SiteTopology — will be JSON.stringify'd
}

export type GenerationType = 'esphome' | 'ha';

export interface GenerationMeta {
  id: number;
  version: string;
  siteId: string;
  systemId: string;
  genType: GenerationType;
  schemaVersion: number;
  fileCount: number;
  checksum: string;
  createdAt: string;
}

export interface GenerationSnapshot extends GenerationMeta {
  topology: string;
  board: string;
}

// ---------------------------------------------------------------------------
// DB versioning & migrations
// ---------------------------------------------------------------------------

const DB_VERSION = 6;

const MIGRATIONS: Record<number, string> = {
  0: `
    CREATE TABLE IF NOT EXISTS generations (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      version        TEXT    NOT NULL UNIQUE,
      config_name    TEXT    NOT NULL,
      schema_version INTEGER NOT NULL,
      topology       TEXT    NOT NULL,
      board          TEXT    NOT NULL,
      file_count     INTEGER NOT NULL DEFAULT 0,
      checksum       TEXT    NOT NULL DEFAULT '',
      created_at     TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    );
    CREATE INDEX IF NOT EXISTS idx_generations_config ON generations (config_name, id DESC);
  `,
  1: `
    -- Sites
    CREATE TABLE sites (
      id            TEXT PRIMARY KEY,
      friendly_name TEXT NOT NULL,
      created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      updated_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    );

    -- Systems (site-scoped)
    CREATE TABLE systems (
      id            TEXT NOT NULL,
      site_id       TEXT NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
      friendly_name TEXT NOT NULL,
      board         TEXT NOT NULL,
      directory     TEXT,
      topology      TEXT NOT NULL,
      position_x    REAL NOT NULL DEFAULT 0,
      position_y    REAL NOT NULL DEFAULT 0,
      created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      updated_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      PRIMARY KEY (id, site_id)
    );

    -- Node ID registry (site-wide uniqueness)
    CREATE TABLE node_ids (
      node_id    TEXT NOT NULL,
      system_id  TEXT NOT NULL,
      site_id    TEXT NOT NULL,
      PRIMARY KEY (node_id, site_id),
      FOREIGN KEY (system_id, site_id) REFERENCES systems(id, site_id) ON DELETE CASCADE
    );

    -- Inter-system links
    CREATE TABLE links (
      id          TEXT NOT NULL,
      site_id     TEXT NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
      from_system TEXT NOT NULL,
      from_node   TEXT NOT NULL,
      from_port   TEXT NOT NULL,
      to_system   TEXT NOT NULL,
      to_node     TEXT NOT NULL,
      to_port     TEXT NOT NULL,
      label       TEXT,
      PRIMARY KEY (id, site_id),
      FOREIGN KEY (from_system, site_id) REFERENCES systems(id, site_id) ON DELETE CASCADE,
      FOREIGN KEY (to_system, site_id) REFERENCES systems(id, site_id) ON DELETE CASCADE
    );

    -- HA config files (per-site)
    CREATE TABLE ha_files (
      site_id   TEXT NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
      filename  TEXT NOT NULL,
      content   TEXT NOT NULL,
      PRIMARY KEY (site_id, filename)
    );

    -- Drop old generations table (no backward compat, clean slate)
    DROP TABLE IF EXISTS generations;

    -- Recreate with proper FK constraints
    CREATE TABLE generations (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      version        TEXT    NOT NULL UNIQUE,
      site_id        TEXT    NOT NULL,
      system_id      TEXT    NOT NULL,
      schema_version INTEGER NOT NULL,
      topology       TEXT    NOT NULL,
      board          TEXT    NOT NULL,
      file_count     INTEGER NOT NULL DEFAULT 0,
      checksum       TEXT    NOT NULL DEFAULT '',
      created_at     TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      FOREIGN KEY (system_id, site_id) REFERENCES systems(id, site_id) ON DELETE CASCADE
    );

    CREATE INDEX idx_generations_system ON generations (site_id, system_id, id DESC);
  `,
  2: `
    -- Drop unused position columns
    ALTER TABLE systems DROP COLUMN position_x;
    ALTER TABLE systems DROP COLUMN position_y;

    -- Add device_name (ESPHome hostname, decoupled from system ID)
    ALTER TABLE systems ADD COLUMN device_name TEXT NOT NULL DEFAULT '';
    UPDATE systems SET device_name = id;

    -- Add sort_order for explicit system ordering
    ALTER TABLE systems ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0;
  `,
  3: `
    -- Generation type: esphome or ha
    ALTER TABLE generations ADD COLUMN gen_type TEXT NOT NULL DEFAULT 'esphome';
    CREATE INDEX idx_generations_type ON generations (site_id, system_id, gen_type, id DESC);

    -- Per-system secrets (WiFi, API key, OTA password, etc.)
    CREATE TABLE system_secrets (
      site_id    TEXT NOT NULL,
      system_id  TEXT NOT NULL,
      key        TEXT NOT NULL,
      value      TEXT NOT NULL,
      PRIMARY KEY (site_id, system_id, key),
      FOREIGN KEY (system_id, site_id) REFERENCES systems(id, site_id) ON DELETE CASCADE
    );
  `,
  4: `
    -- Drop remote_inputs table (migrated to topology node.remote binding)
    DROP TABLE IF EXISTS remote_inputs;

    -- Per-system settings (generator preference, UI state, etc.)
    CREATE TABLE system_settings (
      site_id    TEXT NOT NULL,
      system_id  TEXT NOT NULL,
      key        TEXT NOT NULL,
      value      TEXT NOT NULL,
      PRIMARY KEY (site_id, system_id, key),
      FOREIGN KEY (system_id, site_id) REFERENCES systems(id, site_id) ON DELETE CASCADE
    );
  `,
  5: `
    -- Anchor Mesh migration: flat SiteTopology storage
    ALTER TABLE sites ADD COLUMN topology TEXT;
    ALTER TABLE sites ADD COLUMN schema_version INTEGER NOT NULL DEFAULT 15;
  `,
};

// ---------------------------------------------------------------------------
// Singleton lifecycle
// ---------------------------------------------------------------------------

let _db: Database | null = null;
let _dbPath: string = "";

function persist(): void {
  if (!_db) return;
  const data = _db.export();
  fs.writeFileSync(_dbPath, Buffer.from(data));
}

export async function openDb(storeRoot: string): Promise<void> {
  if (_db) return;

  const SQL = await initSqlJs();
  _dbPath = path.join(storeRoot, "generations.db");

  if (fs.existsSync(_dbPath)) {
    const buffer = fs.readFileSync(_dbPath);
    _db = new SQL.Database(buffer);
  } else {
    _db = new SQL.Database();
  }

  // Enable foreign keys
  _db.run("PRAGMA foreign_keys = ON");

  migrate(_db);
  persist();
}

export function closeDb(): void {
  if (_db) {
    persist();
    _db.close();
    _db = null;
  }
}

function migrate(db: Database): void {
  const row = db.exec("PRAGMA user_version");
  let current = row.length > 0 && row[0].values.length > 0 ? Number(row[0].values[0][0]) : 0;

  while (current < DB_VERSION) {
    const sql = MIGRATIONS[current];
    if (!sql) throw new Error(`Missing DB migration from version ${current}`);
    db.run("BEGIN TRANSACTION");
    db.run(sql);
    db.run(`PRAGMA user_version = ${current + 1}`);
    db.run("COMMIT");
    current++;
  }

  // Post-migration: populate flat topology for sites that still use legacy tables
  migrateLegacySitesToFlatTopology(db);
}

/**
 * For sites created before DB v6, `systems`/`links` tables hold the data
 * but `sites.topology` is NULL. Build a flat SiteTopology JSON from the
 * legacy tables and write it into the new column. Idempotent — skips
 * sites that already have topology.
 */
function migrateLegacySitesToFlatTopology(db: Database): void {
  const sites = queryAll<{ id: string; friendly_name: string }>(
    "SELECT id, friendly_name FROM sites WHERE topology IS NULL",
  );
  if (sites.length === 0) return;

  for (const site of sites) {
    const systems = queryAll<{
      id: string; friendly_name: string; board: string;
      directory: string | null; topology: string; device_name: string;
    }>(
      "SELECT id, friendly_name, board, directory, topology, device_name FROM systems WHERE site_id = ?",
      [site.id],
    );
    if (systems.length === 0) continue;

    const controllers: Array<{ id: string; board: string; friendlyName?: string; network?: unknown }> = [];
    const nodes: unknown[] = [];
    const pipes: Array<{ id: string; from: string; to: string }> = [];
    let route_overrides: Record<string, unknown> = {};
    let timing: unknown;
    const automations: unknown[] = [];

    for (const sys of systems) {
      const topo = JSON.parse(sys.topology) as Record<string, unknown>;
      controllers.push({
        id: sys.id,
        board: sys.board,
        friendlyName: sys.friendly_name,
        network: topo.network,
      });
      for (const n of (topo.nodes as Array<Record<string, unknown>> ?? [])) {
        nodes.push({ ...n, anchorId: sys.id });
      }
      for (const p of (topo.pipes as Array<{ id: string; from: string; to: string }> ?? [])) {
        pipes.push(p);
      }
      route_overrides = { ...route_overrides, ...(topo.route_overrides as Record<string, unknown> ?? {}) };
      for (const a of (topo.automations as unknown[] ?? [])) {
        automations.push(a);
      }
      if (!timing && topo.timing) timing = topo.timing;
    }

    // Migrate legacy links into pipes
    const links = queryAll<{
      id: string; from_system: string; from_node: string; from_port: string;
      to_system: string; to_node: string; to_port: string;
    }>(
      "SELECT id, from_system, from_node, from_port, to_system, to_node, to_port FROM links WHERE site_id = ?",
      [site.id],
    );
    for (const link of links) {
      pipes.push({
        id: link.id,
        from: `${link.from_node}:${link.from_port}`,
        to: `${link.to_node}:${link.to_port}`,
      });
    }

    const siteTopology = {
      schema: 15,
      controllers,
      nodes,
      pipes,
      route_overrides,
      timing: timing ?? { valve_travel_time: 15, flow_watchdog: 30, flow_confirm: 10, flow_threshold: 0.5, api_watchdog: 60, update_interval: 30 },
      automations,
    };

    db.run(
      "UPDATE sites SET topology = ?, schema_version = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?",
      [JSON.stringify(siteTopology), 15, site.id],
    );
  }
}

function getDb(): Database {
  if (!_db) throw new Error("DB not initialized. Call openDb() first.");
  return _db;
}

/** Run a query and return rows as typed objects. */
function queryAll<T>(sql: string, params: unknown[] = []): T[] {
  const db = getDb();
  const stmt = db.prepare(sql);
  stmt.bind(params as (string | number | null)[]);
  const rows: T[] = [];
  while (stmt.step()) {
    rows.push(stmt.getAsObject() as T);
  }
  stmt.free();
  return rows;
}

/** Run a query and return the first row or null. */
/**
 * Recursively strip keys beginning with `_` from a plain object/array tree.
 * Used at the save boundary so rendering-only fields (e.g. `_connectionLabel`
 * on enriched interconnect nodes) can't leak into the stored topology JSON.
 * Primitives, Dates, etc. are returned unchanged.
 */
function stripPrivateFields<T>(value: T): T {
  if (Array.isArray(value)) return value.map(v => stripPrivateFields(v)) as unknown as T;
  if (value && typeof value === 'object' && value.constructor === Object) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      if (k.startsWith('_')) continue;
      out[k] = stripPrivateFields(v);
    }
    return out as T;
  }
  return value;
}

function serializeTopology(topology: unknown): string {
  return JSON.stringify(stripPrivateFields(topology));
}

function queryOne<T>(sql: string, params: unknown[] = []): T | null {
  const rows = queryAll<T>(sql, params);
  return rows[0] ?? null;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** SHA-256 hex digest of the topology + board JSON (deterministic input hash). */
export function inputChecksum(topology: unknown, board: unknown | null, secrets?: Record<string, string>): string {
  const hash = crypto.createHash("sha256");
  hash.update(JSON.stringify(topology));
  if (board != null) hash.update(JSON.stringify(board));
  if (secrets) {
    for (const key of Object.keys(secrets).sort()) {
      hash.update(key);
      hash.update(secrets[key]);
    }
  }
  return hash.digest("hex").slice(0, 16);
}

// ---------------------------------------------------------------------------
// Sites
// ---------------------------------------------------------------------------

export function listSites(): SiteListEntry[] {
  return queryAll<{ id: string; friendly_name: string; topology: string | null }>(
    "SELECT id, friendly_name, topology FROM sites ORDER BY friendly_name",
  ).map(row => {
    let controllerCount = 0;
    let nodeCount = 0;
    if (row.topology) {
      try {
        const topo = JSON.parse(row.topology) as { controllers?: unknown[]; nodes?: unknown[] };
        controllerCount = topo.controllers?.length ?? 0;
        nodeCount = topo.nodes?.length ?? 0;
      } catch { /* ignore malformed topology */ }
    }
    return {
      id: row.id,
      friendlyName: row.friendly_name,
      controllerCount,
      nodeCount,
    };
  });
}

export function createSite(id: string, friendlyName: string): void {
  const emptyTopology = {
    schema: 15,
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
  };
  getDb().run(
    "INSERT INTO sites (id, friendly_name, topology, schema_version) VALUES (?, ?, ?, ?)",
    [id, friendlyName, JSON.stringify(emptyTopology), 15],
  );
  persist();
}

export function deleteSite(id: string): void {
  getDb().run("DELETE FROM sites WHERE id = ?", [id]);
  persist();
}

export function renameSite(id: string, friendlyName: string): void {
  getDb().run(
    "UPDATE sites SET friendly_name = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?",
    [friendlyName, id],
  );
  persist();
}

export function duplicateSite(sourceId: string, newId: string, newFriendlyName: string): void {
  const db = getDb();
  db.run("BEGIN TRANSACTION");
  try {
    const source = queryOne<{ topology: string | null; friendly_name: string }>(
      "SELECT topology, friendly_name FROM sites WHERE id = ?", [sourceId],
    );
    if (!source) throw new Error(`Source site not found: ${sourceId}`);

    db.run(
      "INSERT INTO sites (id, friendly_name, topology, schema_version) VALUES (?, ?, ?, ?)",
      [newId, newFriendlyName, source.topology, 15],
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

    // Copy controller secrets (renamed from system_secrets)
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
}

// ---------------------------------------------------------------------------
// Site full load/save (atomic)
// ---------------------------------------------------------------------------

export function loadSiteFull(id: string): SiteFullPayload | null {
  const site = queryOne<{ id: string; friendly_name: string; topology: string | null }>(
    "SELECT id, friendly_name, topology FROM sites WHERE id = ?", [id],
  );
  if (!site) return null;

  return {
    site: { id: site.id, friendlyName: site.friendly_name },
    topology: site.topology ? JSON.parse(site.topology) : null,
  };
}

export function saveSiteTransaction(payload: SiteSavePayload): void {
  const db = getDb();
  const siteId = payload.site.id;
  const topologyJson = serializeTopology(payload.topology);

  db.run("BEGIN TRANSACTION");
  try {
    // Insert if new, update if existing
    db.run(
      `INSERT INTO sites (id, friendly_name, topology, schema_version, created_at, updated_at)
       VALUES (?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now'))
       ON CONFLICT(id) DO UPDATE SET
        friendly_name = excluded.friendly_name,
        topology = excluded.topology,
        schema_version = excluded.schema_version,
        updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')`,
      [siteId, payload.site.friendlyName, topologyJson, 15],
    );

    db.run("COMMIT");
    persist();
  } catch (e) {
    db.run("ROLLBACK");
    throw e;
  }
}

// ---------------------------------------------------------------------------
// Systems
// ---------------------------------------------------------------------------

export function listSystems(siteId: string): SystemListEntry[] {
  const row = queryOne<{ topology: string | null }>(
    "SELECT topology FROM sites WHERE id = ?", [siteId],
  );
  if (!row?.topology) return [];
  try {
    const topo = JSON.parse(row.topology) as { controllers?: Array<{ id: string; board: string }>; nodes?: unknown[] };
    return (topo.controllers ?? []).map(c => ({
      id: c.id,
      friendlyName: c.id,
      board: c.board,
      nodeCount: (topo.nodes ?? []).filter((n: any) => n.anchorId === c.id).length,
    }));
  } catch {
    return [];
  }
}

/**
 * Get all node IDs registered in a site.
 */
export function getAllNodeIds(siteId: string): string[] {
  const row = queryOne<{ topology: string | null }>(
    "SELECT topology FROM sites WHERE id = ?", [siteId],
  );
  if (!row?.topology) return [];
  try {
    const topo = JSON.parse(row.topology) as { nodes?: Array<{ id: string }> };
    return (topo.nodes ?? []).map(n => n.id);
  } catch {
    return [];
  }
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
  const existing = new Set(getAllNodeIds(siteId));
  return nodeIds.filter(id => existing.has(id));
}

/**
 * Insert a new controller into a site's topology.
 * Caller is responsible for ensuring node IDs don't conflict.
 */
export function insertSystem(
  siteId: string,
  system: {
    id: string;
    friendlyName: string;
    board: string;
    directory: string | null;
    topology: unknown;
    deviceName: string;
  },
): void {
  const db = getDb();
  const site = queryOne<{ topology: string | null }>(
    "SELECT topology FROM sites WHERE id = ?", [siteId],
  );
  if (!site) throw new Error(`Site not found: ${siteId}`);

  const siteTopo = site.topology ? JSON.parse(site.topology) as Record<string, unknown> : {
    schema: 15, controllers: [], nodes: [], pipes: [], route_overrides: {},
    timing: { valve_travel_time: 15, flow_watchdog: 30, flow_confirm: 10, flow_threshold: 0.5, api_watchdog: 60, update_interval: 30 },
    automations: [],
  };
  const incoming = system.topology as Record<string, unknown>;

  // Merge controller
  const controllers = siteTopo.controllers as Array<Record<string, unknown>> ?? [];
  controllers.push({
    id: system.id,
    board: system.board,
    network: (incoming as Record<string, unknown>).network,
  });

  // Merge nodes with anchorId
  const existingNodes = siteTopo.nodes as Array<Record<string, unknown>> ?? [];
  const incomingNodes = (incoming.nodes as Array<Record<string, unknown>> ?? [])
    .map(n => ({ ...n, anchorId: system.id }));
  siteTopo.nodes = [...existingNodes, ...incomingNodes];

  // Merge pipes
  const existingPipes = siteTopo.pipes as Array<Record<string, unknown>> ?? [];
  const incomingPipes = (incoming.pipes as Array<Record<string, unknown>> ?? []);
  siteTopo.pipes = [...existingPipes, ...incomingPipes];

  // Merge route_overrides, timing, automations (last wins)
  siteTopo.route_overrides = { ...(siteTopo.route_overrides as Record<string, unknown> ?? {}), ...(incoming.route_overrides as Record<string, unknown> ?? {}) };
  siteTopo.automations = [...(siteTopo.automations as unknown[] ?? []), ...(incoming.automations as unknown[] ?? [])];

  const topologyJson = serializeTopology(siteTopo);

  db.run(
    "UPDATE sites SET topology = ?, schema_version = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?",
    [topologyJson, 15, siteId],
  );
  persist();
}

export function deleteSystem(siteId: string, systemId: string): void {
  const db = getDb();
  const site = queryOne<{ topology: string | null }>(
    "SELECT topology FROM sites WHERE id = ?", [siteId],
  );
  if (!site?.topology) return;

  const topo = JSON.parse(site.topology) as {
    controllers?: Array<{ id: string }>;
    nodes?: Array<{ id: string; anchorId?: string }>;
    pipes?: Array<{ from: string; to: string }>;
    route_overrides?: Record<string, unknown>;
    automations?: Array<{ route?: string; nodes?: string[] }>;
  };

  // Collect node IDs anchored to this controller
  const removedNodeIds = new Set(
    (topo.nodes ?? [])
      .filter(n => n.anchorId === systemId)
      .map(n => n.id),
  );

  // Remove controller
  topo.controllers = (topo.controllers ?? []).filter(c => c.id !== systemId);

  // Remove anchored nodes
  topo.nodes = (topo.nodes ?? []).filter(n => n.anchorId !== systemId);

  // Remove pipes that reference removed nodes
  topo.pipes = (topo.pipes ?? []).filter(p => {
    const fromNode = p.from.split(':')[0];
    const toNode = p.to.split(':')[0];
    return !removedNodeIds.has(fromNode) && !removedNodeIds.has(toNode);
  });

  // Remove route_overrides for removed nodes
  if (topo.route_overrides) {
    topo.route_overrides = Object.fromEntries(
      Object.entries(topo.route_overrides).filter(([key]) => !removedNodeIds.has(key)),
    );
  }

  // Remove automations referencing removed nodes
  topo.automations = (topo.automations ?? []).filter(a => {
    if (a.route && removedNodeIds.has(a.route)) return false;
    if (a.nodes && a.nodes.some(id => removedNodeIds.has(id))) return false;
    return true;
  });

  db.run(
    "UPDATE sites SET topology = ?, schema_version = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?",
    [JSON.stringify(topo), 15, siteId],
  );
  persist();
}

// ---------------------------------------------------------------------------
// Links
// ---------------------------------------------------------------------------

export function listLinks(_siteId: string): LinkRow[] {
  // Links are now pipes inside the site topology JSON; no separate link table.
  return [];
}

// ---------------------------------------------------------------------------
// HA files
// ---------------------------------------------------------------------------

export function listHaFiles(siteId: string): string[] {
  return queryAll<{ filename: string }>(
    "SELECT filename FROM ha_files WHERE site_id = ? ORDER BY filename",
    [siteId],
  ).map(r => r.filename);
}

export function loadHaFile(siteId: string, filename: string): string | null {
  const row = queryOne<{ content: string }>(
    "SELECT content FROM ha_files WHERE site_id = ? AND filename = ?",
    [siteId, filename],
  );
  return row?.content ?? null;
}

export function saveHaFile(siteId: string, filename: string, content: string): void {
  getDb().run(
    `INSERT INTO ha_files (site_id, filename, content) VALUES (?, ?, ?)
     ON CONFLICT(site_id, filename) DO UPDATE SET content = excluded.content`,
    [siteId, filename, content],
  );
  persist();
}

export function deleteHaFile(siteId: string, filename: string): void {
  getDb().run("DELETE FROM ha_files WHERE site_id = ? AND filename = ?", [siteId, filename]);
  persist();
}

// ---------------------------------------------------------------------------
// Generation history
// ---------------------------------------------------------------------------

export function createGeneration(
  siteId: string,
  systemId: string,
  topology: unknown,
  board: unknown | null,
  genType: GenerationType = 'esphome',
  secrets?: Record<string, string>,
): { version: string; id: number } | null {
  const db = getDb();
  const checksum = inputChecksum(topology, board, secrets);

  const latest = queryOne<{ checksum: string }>(
    `SELECT checksum FROM generations WHERE site_id = ? AND system_id = ? AND gen_type = ? ORDER BY id DESC LIMIT 1`,
    [siteId, systemId, genType],
  );
  if (latest && latest.checksum === checksum) return null;

  const version = crypto.randomBytes(4).toString("hex");
  const topologyJson = serializeTopology(topology);
  const boardJson = JSON.stringify(board);
  db.run(
    `INSERT INTO generations (version, site_id, system_id, schema_version, topology, board, checksum, gen_type)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [version, siteId, systemId, DB_VERSION, topologyJson, boardJson, checksum, genType],
  );

  const row = db.exec("SELECT last_insert_rowid() AS id");
  const id = Number(row[0].values[0][0]);
  persist();
  return { version, id };
}

export function finalizeGeneration(id: number, fileCount: number): void {
  getDb().run("UPDATE generations SET file_count = ? WHERE id = ?", [fileCount, id]);
  persist();
}

export function listGenerations(siteId: string, systemId: string, genType?: GenerationType): GenerationMeta[] {
  const typeClause = genType ? ' AND gen_type = ?' : '';
  const params: unknown[] = [siteId, systemId];
  if (genType) params.push(genType);

  return queryAll<{
    id: number; version: string; site_id: string; system_id: string; gen_type: string;
    schema_version: number; file_count: number; checksum: string; created_at: string;
  }>(
    `SELECT id, version, site_id, system_id, gen_type, schema_version, file_count, checksum, created_at
     FROM generations
     WHERE site_id = ? AND system_id = ?${typeClause}
     ORDER BY id DESC`,
    params,
  ).map(r => ({
    id: r.id,
    version: r.version,
    siteId: r.site_id,
    systemId: r.system_id,
    genType: r.gen_type as GenerationType,
    schemaVersion: r.schema_version,
    fileCount: r.file_count,
    checksum: r.checksum,
    createdAt: r.created_at,
  }));
}

function mapGenerationSnapshot(row: {
  id: number; version: string; site_id: string; system_id: string; gen_type: string;
  schema_version: number; file_count: number; checksum: string; created_at: string;
  topology: string; board: string;
}): GenerationSnapshot {
  return {
    id: row.id,
    version: row.version,
    siteId: row.site_id,
    systemId: row.system_id,
    genType: row.gen_type as GenerationType,
    schemaVersion: row.schema_version,
    fileCount: row.file_count,
    checksum: row.checksum,
    createdAt: row.created_at,
    topology: row.topology,
    board: row.board,
  };
}

export function loadGeneration(id: number): GenerationSnapshot | null {
  const row = queryOne<{
    id: number; version: string; site_id: string; system_id: string; gen_type: string;
    schema_version: number; file_count: number; checksum: string; created_at: string;
    topology: string; board: string;
  }>(
    `SELECT id, version, site_id, system_id, gen_type, schema_version, file_count, checksum, created_at, topology, board
     FROM generations WHERE id = ?`,
    [id],
  );
  return row ? mapGenerationSnapshot(row) : null;
}

export function loadGenerationByVersion(version: string): GenerationSnapshot | null {
  const row = queryOne<{
    id: number; version: string; site_id: string; system_id: string; gen_type: string;
    schema_version: number; file_count: number; checksum: string; created_at: string;
    topology: string; board: string;
  }>(
    `SELECT id, version, site_id, system_id, gen_type, schema_version, file_count, checksum, created_at, topology, board
     FROM generations WHERE version = ?`,
    [version],
  );
  return row ? mapGenerationSnapshot(row) : null;
}

export function pruneGenerations(siteId: string, systemId: string, keepCount: number = 10, genType?: GenerationType): number {
  const db = getDb();
  const typeClause = genType ? ' AND gen_type = ?' : '';
  const baseParams: unknown[] = [siteId, systemId];
  if (genType) baseParams.push(genType);

  const before = queryAll<{ id: number }>(
    `SELECT id FROM generations WHERE site_id = ? AND system_id = ?${typeClause}`,
    baseParams,
  ).length;

  const deleteParams: unknown[] = [siteId, systemId];
  if (genType) deleteParams.push(genType);
  deleteParams.push(siteId, systemId);
  if (genType) deleteParams.push(genType);
  deleteParams.push(keepCount);

  db.run(
    `DELETE FROM generations
     WHERE site_id = ? AND system_id = ?${typeClause}
       AND id NOT IN (
         SELECT id FROM generations
         WHERE site_id = ? AND system_id = ?${typeClause}
         ORDER BY id DESC
         LIMIT ?
       )`,
    deleteParams as (string | number)[],
  );

  const after = queryAll<{ id: number }>(
    `SELECT id FROM generations WHERE site_id = ? AND system_id = ?${typeClause}`,
    baseParams as (string | number)[],
  ).length;

  persist();
  return before - after;
}

// ---------------------------------------------------------------------------
// System secrets
// ---------------------------------------------------------------------------

export function getSecrets(siteId: string, systemId: string): Record<string, string> {
  const rows = queryAll<{ key: string; value: string }>(
    `SELECT key, value FROM system_secrets WHERE site_id = ? AND system_id = ?`,
    [siteId, systemId],
  );
  const result: Record<string, string> = {};
  for (const r of rows) result[r.key] = r.value;
  return result;
}

export function setSecrets(siteId: string, systemId: string, secrets: Record<string, string>): void {
  const db = getDb();
  for (const [key, value] of Object.entries(secrets)) {
    db.run(
      `INSERT INTO system_secrets (site_id, system_id, key, value) VALUES (?, ?, ?, ?)
       ON CONFLICT(site_id, system_id, key) DO UPDATE SET value = excluded.value`,
      [siteId, systemId, key, value],
    );
  }
  persist();
}

// ---------------------------------------------------------------------------
// System settings (generator preference, etc.)
// ---------------------------------------------------------------------------

export function getSetting(siteId: string, systemId: string, key: string): string | null {
  const row = queryOne<{ value: string }>(
    `SELECT value FROM system_settings WHERE site_id = ? AND system_id = ? AND key = ?`,
    [siteId, systemId, key],
  );
  return row?.value ?? null;
}

export function setSetting(siteId: string, systemId: string, key: string, value: string): void {
  getDb().run(
    `INSERT INTO system_settings (site_id, system_id, key, value) VALUES (?, ?, ?, ?)
     ON CONFLICT(site_id, system_id, key) DO UPDATE SET value = excluded.value`,
    [siteId, systemId, key, value],
  );
  persist();
}

export function getSettings(siteId: string, systemId: string): Record<string, string> {
  const rows = queryAll<{ key: string; value: string }>(
    `SELECT key, value FROM system_settings WHERE site_id = ? AND system_id = ?`,
    [siteId, systemId],
  );
  const result: Record<string, string> = {};
  for (const r of rows) result[r.key] = r.value;
  return result;
}
