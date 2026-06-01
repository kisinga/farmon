import initSqlJs, { type Database } from "sql.js";
import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

import type { SiteListEntry } from '@far-mon/core';
import { parseTopology } from '@far-mon/core';

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

const DB_VERSION = 13;

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
    ALTER TABLE sites ADD COLUMN schema_version INTEGER NOT NULL DEFAULT 16;
  `,
  6: `
    -- Fleet telemetry: deployment tracking
    CREATE TABLE deployments (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      site_id       TEXT NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
      system_id     TEXT NOT NULL,
      generation_id INTEGER NOT NULL REFERENCES generations(id),
      method        TEXT NOT NULL,
      target_addr   TEXT,
      status        TEXT NOT NULL,
      started_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      completed_at  TEXT,
      error_message TEXT,
      verified_sha  TEXT,
      verified_at   TEXT
    );
    CREATE INDEX idx_deployments_site ON deployments (site_id, system_id, id DESC);
  `,
  7: `
    -- App settings (HA connection, drift detector config, etc.)
    CREATE TABLE app_settings (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `,
  8: `
    -- Event-sourced topology log
    CREATE TABLE topology_events (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      site_id     TEXT NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
      timestamp   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      actor       TEXT,
      event_type  TEXT NOT NULL,
      payload     TEXT NOT NULL
    );
    CREATE INDEX idx_topology_events_site ON topology_events (site_id, id DESC);
  `,
  9: `
    -- Defensive: ensure topology_events table exists (some early DBs may have missed v8)
    CREATE TABLE IF NOT EXISTS topology_events (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      site_id     TEXT NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
      timestamp   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      actor       TEXT,
      event_type  TEXT NOT NULL,
      payload     TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_topology_events_site ON topology_events (site_id, id DESC);
  `,
  10: `
    -- Drop legacy topology blob columns; events are now the SSOT
    ALTER TABLE sites DROP COLUMN topology;
    ALTER TABLE sites DROP COLUMN schema_version;
  `,
  11: `
    -- Product catalog: user-editable hardware inventory
    CREATE TABLE product_catalog (
      id                TEXT PRIMARY KEY,
      category          TEXT NOT NULL,
      sub_category      TEXT,
      name              TEXT NOT NULL,
      manufacturer      TEXT NOT NULL,
      manufacturer_pn   TEXT,
      specs             TEXT NOT NULL DEFAULT '{}',
      unit_cost_usd     REAL,
      currency          TEXT DEFAULT 'KES',
      description       TEXT,
      selection_help    TEXT,
      reliability_score REAL,
      is_active         INTEGER NOT NULL DEFAULT 1,
      is_user_defined   INTEGER NOT NULL DEFAULT 0,
      created_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    );
    CREATE INDEX idx_catalog_category ON product_catalog (category, sub_category);
    CREATE INDEX idx_catalog_active ON product_catalog (is_active);

    -- Site hardware manifests: versioned snapshots
    CREATE TABLE site_manifests (
      id                INTEGER PRIMARY KEY AUTOINCREMENT,
      site_id           TEXT NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
      manifest_version  INTEGER NOT NULL,
      manifest_type     TEXT NOT NULL,
      created_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      topology_checksum TEXT,
      customer_name     TEXT,
      customer_email    TEXT,
      customer_phone    TEXT,
      notes             TEXT,
      items             TEXT NOT NULL DEFAULT '[]',
      FOREIGN KEY (site_id) REFERENCES sites(id) ON DELETE CASCADE
    );
    CREATE INDEX idx_manifests_site ON site_manifests (site_id, manifest_version DESC);

    -- Product feedback / field reliability tracking
    CREATE TABLE product_feedback (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      catalog_id    TEXT NOT NULL REFERENCES product_catalog(id),
      site_id       TEXT REFERENCES sites(id) ON DELETE SET NULL,
      manifest_id   INTEGER REFERENCES site_manifests(id) ON DELETE SET NULL,
      deployed_at   TEXT,
      feedback      TEXT NOT NULL,
      rating        INTEGER,
      reported_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    );
    CREATE INDEX idx_feedback_catalog ON product_feedback (catalog_id);
  `,
  12: `
    -- Refactor: flat catalog → component registry + product lines with variants
    -- Clean up orphaned feedback before dropping the old catalog table.
    DELETE FROM product_feedback WHERE catalog_id NOT IN (SELECT id FROM product_catalog);

    DROP TABLE IF EXISTS product_catalog;

    CREATE TABLE product_catalog (
      id                TEXT PRIMARY KEY,
      component_id      TEXT NOT NULL,
      manufacturer      TEXT NOT NULL,
      name              TEXT NOT NULL,
      manufacturer_pn   TEXT,
      description       TEXT,
      selection_help    TEXT,
      reliability_score REAL,
      base_specs        TEXT NOT NULL DEFAULT '{}',
      variants          TEXT NOT NULL DEFAULT '[]',
      is_active         INTEGER NOT NULL DEFAULT 1,
      is_user_defined   INTEGER NOT NULL DEFAULT 0,
      created_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    );
    CREATE INDEX idx_catalog_component ON product_catalog (component_id, is_active);

    CREATE TABLE quote_defaults (
      component_id    TEXT PRIMARY KEY,
      manufacturer_id TEXT NOT NULL REFERENCES product_catalog(id),
      params          TEXT NOT NULL DEFAULT '{}'
    );
  `,
};

// ---------------------------------------------------------------------------
// Singleton lifecycle
// ---------------------------------------------------------------------------

let _db: Database | null = null;
let _dbPath: string = "";

export function persist(): void {
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

  // Pre-migration: convert topology blobs to snapshot events before v10 drops the columns.
  if (hasTopologyColumn(db)) {
    migrateV11Data(db);
  }

  while (current < DB_VERSION) {
    const sql = MIGRATIONS[current];
    if (!sql) throw new Error(`Missing DB migration from version ${current}`);
    db.run("BEGIN TRANSACTION");
    db.run(sql);
    db.run(`PRAGMA user_version = ${current + 1}`);
    db.run("COMMIT");
    current++;
  }

  // Post-migration: populate flat topology for sites that still use legacy tables.
  // Only run when we just upgraded to v6 — idempotent but avoids needless work.
  if (current === 6) {
    migrateLegacySitesToFlatTopology(db);
  }
}

function hasTopologyColumn(db: Database): boolean {
  const result = db.exec("SELECT COUNT(*) as c FROM pragma_table_info('sites') WHERE name = 'topology'");
  return (result[0]?.values[0][0] as number ?? 0) > 0;
}

/** Migrate v11: convert sites.topology blobs into snapshot events. */
function migrateV11Data(db: Database): void {
  const sites = queryAll<{ id: string; topology: string | null }>(
    "SELECT id, topology FROM sites WHERE topology IS NOT NULL",
  );
  for (const site of sites) {
    if (!site.topology) continue;
    try {
      const topology = parseTopology(JSON.parse(site.topology));
      db.run(
        `INSERT INTO topology_events (site_id, actor, event_type, payload)
         VALUES (?, ?, ?, ?)`,
        [site.id, 'system', 'snapshot', JSON.stringify({ topology })],
      );
    } catch (e) {
      console.error(`[migrateV11] Failed to migrate site ${site.id}:`, e);
    }
  }
  persist();
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

    const controllers: Array<{ id: string; board: string; friendlyName?: string; directory?: string; network?: unknown; uart_buses?: unknown; io_providers?: unknown }> = [];
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
        directory: sys.directory ?? undefined,
        network: topo.network,
        uart_buses: topo.uart_buses,
        io_providers: topo.io_providers,
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
      schema: 17,
      controllers,
      nodes,
      pipes,
      route_overrides,
      timing: timing ?? { valve_travel_time: 15, flow_watchdog: 30, flow_confirm: 10, flow_threshold: 0.5, api_watchdog: 60, update_interval: 30 },
      automations,
      remoteImports: [],
    };

    db.run(
      "UPDATE sites SET topology = ?, schema_version = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?",
      [JSON.stringify(siteTopology), 16, site.id],
    );
  }
}

export function getDb(): Database {
  if (!_db) throw new Error("DB not initialized. Call openDb() first.");
  return _db;
}

/** Run a query and return rows as typed objects. */
export function queryAll<T>(sql: string, params: unknown[] = []): T[] {
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

export function queryOne<T>(sql: string, params: unknown[] = []): T | null {
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
// Deployments
// ---------------------------------------------------------------------------

export interface Deployment {
  id: number;
  siteId: string;
  systemId: string;
  generationId: number;
  method: string;
  targetAddr: string | null;
  status: string;
  startedAt: string;
  completedAt: string | null;
  errorMessage: string | null;
  verifiedSha: string | null;
  verifiedAt: string | null;
}

export function createDeployment(
  siteId: string,
  systemId: string,
  generationId: number,
  method: string,
  targetAddr?: string,
): Deployment {
  const db = getDb();
  db.run(
    `INSERT INTO deployments (site_id, system_id, generation_id, method, target_addr, status, started_at)
     VALUES (?, ?, ?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ','now'))`,
    [siteId, systemId, generationId, method, targetAddr ?? null, 'pending'],
  );
  const row = db.exec("SELECT last_insert_rowid() AS id");
  const id = Number(row[0].values[0][0]);
  persist();
  return {
    id,
    siteId,
    systemId,
    generationId,
    method,
    targetAddr: targetAddr ?? null,
    status: 'pending',
    startedAt: new Date().toISOString(),
    completedAt: null,
    errorMessage: null,
    verifiedSha: null,
    verifiedAt: null,
  };
}

export function updateDeploymentStatus(
  id: number,
  status: string,
  errorMessage?: string,
): void {
  getDb().run(
    `UPDATE deployments
     SET status = ?, error_message = ?, completed_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
     WHERE id = ?`,
    [status, errorMessage ?? null, id],
  );
  persist();
}

export function verifyDeployment(id: number, sha: string): void {
  getDb().run(
    `UPDATE deployments
     SET verified_sha = ?, verified_at = strftime('%Y-%m-%dT%H:%M:%fZ','now'), status = 'verified'
     WHERE id = ?`,
    [sha, id],
  );
  persist();
}

export function listDeployments(siteId: string, systemId?: string): Deployment[] {
  const systemClause = systemId ? ' AND system_id = ?' : '';
  const params: unknown[] = [siteId];
  if (systemId) params.push(systemId);

  return queryAll<{
    id: number; site_id: string; system_id: string; generation_id: number;
    method: string; target_addr: string | null; status: string;
    started_at: string; completed_at: string | null; error_message: string | null;
    verified_sha: string | null; verified_at: string | null;
  }>(
    `SELECT id, site_id, system_id, generation_id, method, target_addr, status,
            started_at, completed_at, error_message, verified_sha, verified_at
     FROM deployments
     WHERE site_id = ?${systemClause}
     ORDER BY id DESC`,
    params,
  ).map(r => ({
    id: r.id,
    siteId: r.site_id,
    systemId: r.system_id,
    generationId: r.generation_id,
    method: r.method,
    targetAddr: r.target_addr,
    status: r.status,
    startedAt: r.started_at,
    completedAt: r.completed_at,
    errorMessage: r.error_message,
    verifiedSha: r.verified_sha,
    verifiedAt: r.verified_at,
  }));
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

// ---------------------------------------------------------------------------
// App settings (global)
// ---------------------------------------------------------------------------

export function getAppSetting(key: string): string | null {
  const row = queryOne<{ value: string }>(
    `SELECT value FROM app_settings WHERE key = ?`,
    [key],
  );
  return row?.value ?? null;
}

export function setAppSetting(key: string, value: string): void {
  getDb().run(
    `INSERT INTO app_settings (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    [key, value],
  );
  persist();
}

// ---------------------------------------------------------------------------
// Topology events (event-sourced configuration log)
// ---------------------------------------------------------------------------

export interface TopologyEventRow {
  id: number;
  siteId: string;
  timestamp: string;
  actor: string | null;
  eventType: string;
  payload: string;
}

export function appendTopologyEvents(siteId: string, events: Array<{ actor: string; eventType: string; payload: unknown }>): void {
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

export function listTopologyEvents(siteId: string, limit?: number): TopologyEventRow[] {
  const sql = limit
    ? `SELECT id, site_id, timestamp, actor, event_type, payload FROM topology_events WHERE site_id = ? ORDER BY id DESC LIMIT ?`
    : `SELECT id, site_id, timestamp, actor, event_type, payload FROM topology_events WHERE site_id = ? ORDER BY id DESC`;
  const params = limit ? [siteId, limit] : [siteId];
  return queryAll<{ id: number; site_id: string; timestamp: string; actor: string | null; event_type: string; payload: string }>(
    sql, params,
  ).map(r => ({
    id: r.id,
    siteId: r.site_id,
    timestamp: r.timestamp,
    actor: r.actor,
    eventType: r.event_type,
    payload: r.payload,
  }));
}

export function topologyEventCount(siteId: string): number {
  const row = queryOne<{ count: number }>(
    `SELECT COUNT(*) as count FROM topology_events WHERE site_id = ?`,
    [siteId],
  );
  return row?.count ?? 0;
}

export function getTopologyEvent(siteId: string, eventId: number): TopologyEventRow | null {
  const row = queryOne<{ id: number; site_id: string; timestamp: string; actor: string | null; event_type: string; payload: string }>(
    `SELECT id, site_id, timestamp, actor, event_type, payload FROM topology_events WHERE site_id = ? AND id = ?`,
    [siteId, eventId],
  );
  return row ? {
    id: row.id,
    siteId: row.site_id,
    timestamp: row.timestamp,
    actor: row.actor,
    eventType: row.event_type,
    payload: row.payload,
  } : null;
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


// ---------------------------------------------------------------------------
// Product Catalog
// ---------------------------------------------------------------------------

export interface ProductLineRow {
  id: string;
  component_id: string;
  manufacturer: string;
  name: string;
  manufacturer_pn: string | null;
  description: string | null;
  selection_help: string | null;
  reliability_score: number | null;
  base_specs: string; // JSON
  variants: string; // JSON
  is_active: number;
  is_user_defined: number;
  created_at: string;
}

export interface QuoteDefaultsRow {
  component_id: string;
  manufacturer_id: string;
  params: string; // JSON
}

export function seedCatalogIfEmpty(lines: Array<{
  id: string;
  componentId: string;
  manufacturer: string;
  name: string;
  manufacturerPartNumber?: string;
  description: string;
  selectionHelp?: string;
  reliabilityScore?: number;
  baseSpecs: Record<string, string>;
  variants: Array<{ params: Record<string, string>; unitCost: number; currency: string; partNumber?: string; isActive: boolean }>;
  isActive: boolean;
  isUserDefined: boolean;
}>, defaults: Array<{
  componentId: string;
  manufacturerId: string;
  params: Record<string, string>;
}>): void {
  const count = queryOne<{ c: number }>(`SELECT COUNT(*) as c FROM product_catalog`);
  if ((count?.c ?? 0) > 0) return;

  const db = getDb();
  db.run('BEGIN TRANSACTION');
  try {
    for (const item of lines) {
    db.run(
      `INSERT INTO product_catalog (
        id, component_id, manufacturer, name, manufacturer_pn,
        description, selection_help, reliability_score,
        base_specs, variants, is_active, is_user_defined
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        item.id,
        item.componentId,
        item.manufacturer,
        item.name,
        item.manufacturerPartNumber ?? null,
        item.description,
        item.selectionHelp ?? null,
        item.reliabilityScore ?? null,
        JSON.stringify(item.baseSpecs),
        JSON.stringify(item.variants),
        item.isActive ? 1 : 0,
        item.isUserDefined ? 1 : 0,
      ],
    );
  }

    for (const d of defaults) {
      db.run(
        `INSERT INTO quote_defaults (component_id, manufacturer_id, params) VALUES (?, ?, ?)`,
        [d.componentId, d.manufacturerId, JSON.stringify(d.params)],
      );
    }

    db.run('COMMIT');
    persist();
  } catch (err) {
    db.run('ROLLBACK');
    throw err;
  }
}

export function listCatalogItems(componentId?: string): ProductLineRow[] {
  const sql = componentId
    ? `SELECT * FROM product_catalog WHERE component_id = ? ORDER BY component_id, name`
    : `SELECT * FROM product_catalog ORDER BY component_id, name`;
  const params = componentId ? [componentId] : [];
  return queryAll<ProductLineRow>(sql, params);
}

export function listActiveCatalogItems(componentId?: string): ProductLineRow[] {
  const sql = componentId
    ? `SELECT * FROM product_catalog WHERE is_active = 1 AND component_id = ? ORDER BY component_id, name`
    : `SELECT * FROM product_catalog WHERE is_active = 1 ORDER BY component_id, name`;
  const params = componentId ? [componentId] : [];
  return queryAll<ProductLineRow>(sql, params);
}

export function getCatalogItem(id: string): ProductLineRow | null {
  return queryOne<ProductLineRow>(
    `SELECT * FROM product_catalog WHERE id = ?`,
    [id],
  );
}

export function upsertCatalogItem(item: Omit<ProductLineRow, 'created_at'>): void {
  getDb().run(
    `INSERT INTO product_catalog (
      id, component_id, manufacturer, name, manufacturer_pn,
      description, selection_help, reliability_score,
      base_specs, variants, is_active, is_user_defined
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      component_id = excluded.component_id,
      manufacturer = excluded.manufacturer,
      name = excluded.name,
      manufacturer_pn = excluded.manufacturer_pn,
      description = excluded.description,
      selection_help = excluded.selection_help,
      reliability_score = excluded.reliability_score,
      base_specs = excluded.base_specs,
      variants = excluded.variants,
      is_active = excluded.is_active,
      is_user_defined = excluded.is_user_defined`,
    [
      item.id, item.component_id, item.manufacturer, item.name,
      item.manufacturer_pn, item.description, item.selection_help,
      item.reliability_score, item.base_specs, item.variants,
      item.is_active, item.is_user_defined,
    ],
  );
  persist();
}

export function deactivateCatalogItem(id: string): void {
  getDb().run(
    `UPDATE product_catalog SET is_active = 0 WHERE id = ?`,
    [id],
  );
  persist();
}

export function getQuoteDefaults(): QuoteDefaultsRow[] {
  return queryAll<QuoteDefaultsRow>(`SELECT * FROM quote_defaults`);
}

export function setQuoteDefaults(componentId: string, manufacturerId: string, params: string): void {
  getDb().run(
    `INSERT INTO quote_defaults (component_id, manufacturer_id, params)
     VALUES (?, ?, ?)
     ON CONFLICT(component_id) DO UPDATE SET
       manufacturer_id = excluded.manufacturer_id,
       params = excluded.params`,
    [componentId, manufacturerId, params],
  );
  persist();
}

// ---------------------------------------------------------------------------
// Site Manifests
// ---------------------------------------------------------------------------

export interface ManifestRow {
  id: number;
  site_id: string;
  manifest_version: number;
  manifest_type: 'quote' | 'deployment' | 'revision';
  created_at: string;
  topology_checksum: string | null;
  customer_name: string | null;
  customer_email: string | null;
  customer_phone: string | null;
  notes: string | null;
  items: string; // JSON
}

export interface ManifestInsert {
  manifest_type: 'quote' | 'deployment' | 'revision';
  topology_checksum?: string;
  customer_name?: string;
  customer_email?: string;
  customer_phone?: string;
  notes?: string;
  items: Array<{ manufacturerId: string; params: Record<string, string>; quantity: number; unitPriceAtTime: number; notes?: string }>;
}

export function listManifests(siteId: string): ManifestRow[] {
  return queryAll<ManifestRow>(
    `SELECT * FROM site_manifests WHERE site_id = ? ORDER BY manifest_version DESC`,
    [siteId],
  );
}

export function getManifest(siteId: string, version: number): ManifestRow | null {
  return queryOne<ManifestRow>(
    `SELECT * FROM site_manifests WHERE site_id = ? AND manifest_version = ?`,
    [siteId, version],
  );
}

export function getLatestManifest(siteId: string): ManifestRow | null {
  return queryOne<ManifestRow>(
    `SELECT * FROM site_manifests WHERE site_id = ? ORDER BY manifest_version DESC LIMIT 1`,
    [siteId],
  );
}

export function saveManifest(siteId: string, data: ManifestInsert): number {
  const latest = queryOne<{ max_version: number }>(
    `SELECT COALESCE(MAX(manifest_version), 0) as max_version FROM site_manifests WHERE site_id = ?`,
    [siteId],
  );
  const nextVersion = (latest?.max_version ?? 0) + 1;

  getDb().run(
    `INSERT INTO site_manifests (
      site_id, manifest_version, manifest_type, topology_checksum,
      customer_name, customer_email, customer_phone, notes, items
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      siteId,
      nextVersion,
      data.manifest_type,
      data.topology_checksum ?? null,
      data.customer_name ?? null,
      data.customer_email ?? null,
      data.customer_phone ?? null,
      data.notes ?? null,
      JSON.stringify(data.items),
    ],
  );
  persist();
  return nextVersion;
}

// ---------------------------------------------------------------------------
// Product Feedback
// ---------------------------------------------------------------------------

export interface FeedbackRow {
  id: number;
  catalog_id: string;
  site_id: string | null;
  manifest_id: number | null;
  deployed_at: string | null;
  feedback: string;
  rating: number | null;
  reported_at: string;
}

export interface FeedbackInsert {
  catalog_id: string;
  site_id?: string;
  manifest_id?: number;
  deployed_at?: string;
  feedback: string;
  rating?: number;
}

export function listFeedback(catalogId?: string): FeedbackRow[] {
  if (catalogId) {
    return queryAll<FeedbackRow>(
      `SELECT * FROM product_feedback WHERE catalog_id = ? ORDER BY reported_at DESC`,
      [catalogId],
    );
  }
  return queryAll<FeedbackRow>(
    `SELECT * FROM product_feedback ORDER BY reported_at DESC`,
  );
}

export function addFeedback(data: FeedbackInsert): void {
  getDb().run(
    `INSERT INTO product_feedback (catalog_id, site_id, manifest_id, deployed_at, feedback, rating)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [
      data.catalog_id,
      data.site_id ?? null,
      data.manifest_id ?? null,
      data.deployed_at ?? null,
      data.feedback,
      data.rating ?? null,
    ],
  );
  persist();
}
