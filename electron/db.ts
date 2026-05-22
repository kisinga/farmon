import initSqlJs, { type Database } from "sql.js";
import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SiteListEntry {
  id: string;
  friendlyName: string;
  systemCount: number;
  linkCount: number;
}

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
  systems: Array<{
    id: string;
    friendlyName: string;
    board: string;
    directory: string | null;
    topology: unknown; // parsed JSON
    deviceName: string;
  }>;
  links: LinkRow[];
}

export interface SiteSavePayload {
  site: { id: string; friendlyName: string };
  systems: Array<{
    id: string;
    friendlyName: string;
    board: string;
    directory: string | null;
    topology: unknown; // will be JSON.stringify'd
    deviceName: string;
  }>;
  links: Array<{
    id: string;
    fromSystem: string;
    fromNode: string;
    fromPort: string;
    toSystem: string;
    toNode: string;
    toPort: string;
    label?: string | null;
  }>;
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

const DB_VERSION = 5;

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
  return queryAll<{ id: string; friendly_name: string }>(
    "SELECT id, friendly_name FROM sites ORDER BY friendly_name",
  ).map(row => {
    const sysCnt = queryOne<{ c: number }>(
      "SELECT COUNT(*) as c FROM systems WHERE site_id = ?", [row.id],
    );
    const linkCnt = queryOne<{ c: number }>(
      "SELECT COUNT(*) as c FROM links WHERE site_id = ?", [row.id],
    );
    return {
      id: row.id,
      friendlyName: row.friendly_name,
      systemCount: sysCnt?.c ?? 0,
      linkCount: linkCnt?.c ?? 0,
    };
  });
}

export function createSite(id: string, friendlyName: string): void {
  getDb().run("INSERT INTO sites (id, friendly_name) VALUES (?, ?)", [id, friendlyName]);
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
    db.run("INSERT INTO sites (id, friendly_name) VALUES (?, ?)", [newId, newFriendlyName]);

    // Copy systems
    const systems = queryAll<{
      id: string;
      friendly_name: string;
      board: string;
      directory: string | null;
      topology: string;
      device_name: string;
      sort_order: number;
    }>(
      "SELECT id, friendly_name, board, directory, topology, device_name, sort_order FROM systems WHERE site_id = ?",
      [sourceId],
    );
    for (const sys of systems) {
      db.run(
        `INSERT INTO systems (id, site_id, friendly_name, board, directory, topology, device_name, sort_order)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [sys.id, newId, sys.friendly_name, sys.board, sys.directory, sys.topology, sys.device_name, sys.sort_order],
      );
    }

    // Copy node_ids
    const nodeIds = queryAll<{ node_id: string; system_id: string }>(
      "SELECT node_id, system_id FROM node_ids WHERE site_id = ?", [sourceId],
    );
    for (const ni of nodeIds) {
      db.run(
        "INSERT INTO node_ids (node_id, system_id, site_id) VALUES (?, ?, ?)",
        [ni.node_id, ni.system_id, newId],
      );
    }

    // Copy links
    const links = queryAll<LinkRow>(
      `SELECT id, from_system, from_node, from_port, to_system, to_node, to_port, label
       FROM links WHERE site_id = ?`,
      [sourceId],
    );
    for (const link of links) {
      db.run(
        `INSERT INTO links (id, site_id, from_system, from_node, from_port, to_system, to_node, to_port, label)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [link.id, newId, link.fromSystem, link.fromNode, link.fromPort,
         link.toSystem, link.toNode, link.toPort, link.label],
      );
    }

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

    // Copy system secrets
    const secrets = queryAll<{ system_id: string; key: string; value: string }>(
      "SELECT system_id, key, value FROM system_secrets WHERE site_id = ?", [sourceId],
    );
    for (const s of secrets) {
      db.run(
        "INSERT INTO system_secrets (site_id, system_id, key, value) VALUES (?, ?, ?, ?)",
        [newId, s.system_id, s.key, s.value],
      );
    }

    // Copy system settings
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
  const site = queryOne<{ id: string; friendly_name: string }>(
    "SELECT id, friendly_name FROM sites WHERE id = ?", [id],
  );
  if (!site) return null;

  const systems = queryAll<{
    id: string; friendly_name: string; board: string; directory: string | null;
    topology: string; device_name: string; sort_order: number;
  }>(
    `SELECT id, friendly_name, board, directory, topology, device_name, sort_order
     FROM systems WHERE site_id = ? ORDER BY sort_order, id`,
    [id],
  );

  const links = queryAll<{
    id: string; from_system: string; from_node: string; from_port: string;
    to_system: string; to_node: string; to_port: string; label: string | null;
  }>(
    `SELECT id, from_system, from_node, from_port, to_system, to_node, to_port, label
     FROM links WHERE site_id = ?`,
    [id],
  );

  return {
    site: { id: site.id, friendlyName: site.friendly_name },
    systems: systems.map(s => ({
      id: s.id,
      friendlyName: s.friendly_name,
      board: s.board,
      directory: s.directory,
      topology: JSON.parse(s.topology),
      deviceName: s.device_name,
    })),
    links: links.map(l => ({
      id: l.id,
      siteId: id,
      fromSystem: l.from_system,
      fromNode: l.from_node,
      fromPort: l.from_port,
      toSystem: l.to_system,
      toNode: l.to_node,
      toPort: l.to_port,
      label: l.label,
    })),
  };
}

export function saveSiteTransaction(payload: SiteSavePayload): void {
  const db = getDb();
  const siteId = payload.site.id;

  db.run("BEGIN TRANSACTION");
  try {
    // Upsert site
    db.run(
      `INSERT INTO sites (id, friendly_name) VALUES (?, ?)
       ON CONFLICT(id) DO UPDATE SET
         friendly_name = excluded.friendly_name,
         updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')`,
      [siteId, payload.site.friendlyName],
    );

    // Get existing system IDs for this site
    const existingSystemIds = new Set(
      queryAll<{ id: string }>("SELECT id FROM systems WHERE site_id = ?", [siteId])
        .map(r => r.id),
    );
    const newSystemIds = new Set(payload.systems.map(s => s.id));

    // Delete systems that are no longer in the payload
    for (const oldId of existingSystemIds) {
      if (!newSystemIds.has(oldId)) {
        db.run("DELETE FROM systems WHERE id = ? AND site_id = ?", [oldId, siteId]);
      }
    }

    // Upsert systems
    for (const sys of payload.systems) {
      const topologyJson = serializeTopology(sys.topology);
      db.run(
        `INSERT INTO systems (id, site_id, friendly_name, board, directory, topology, device_name)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id, site_id) DO UPDATE SET
           friendly_name = excluded.friendly_name,
           board = excluded.board,
           directory = excluded.directory,
           topology = excluded.topology,
           device_name = excluded.device_name,
           updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')`,
        [sys.id, siteId, sys.friendlyName, sys.board, sys.directory ?? null,
         topologyJson, sys.deviceName],
      );
    }

    // Rebuild node_ids for this site
    db.run("DELETE FROM node_ids WHERE site_id = ?", [siteId]);
    for (const sys of payload.systems) {
      const topo = sys.topology as { nodes?: Array<{ id?: string }> };
      const nodes = Array.isArray(topo?.nodes) ? topo.nodes : [];
      for (const node of nodes) {
        if (node.id) {
          db.run(
            "INSERT OR IGNORE INTO node_ids (node_id, system_id, site_id) VALUES (?, ?, ?)",
            [node.id, sys.id, siteId],
          );
        }
      }
    }

    // Replace all links
    db.run("DELETE FROM links WHERE site_id = ?", [siteId]);
    for (const link of payload.links) {
      db.run(
        `INSERT INTO links (id, site_id, from_system, from_node, from_port, to_system, to_node, to_port, label)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [link.id, siteId, link.fromSystem, link.fromNode, link.fromPort,
         link.toSystem, link.toNode, link.toPort, link.label ?? null],
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
// Systems
// ---------------------------------------------------------------------------

export function listSystems(siteId: string): SystemListEntry[] {
  return queryAll<{ id: string; friendly_name: string; board: string; topology: string }>(
    "SELECT id, friendly_name, board, topology FROM systems WHERE site_id = ? ORDER BY id",
    [siteId],
  ).map(row => {
    let nodeCount = 0;
    try {
      const topo = JSON.parse(row.topology);
      nodeCount = Array.isArray(topo.nodes) ? topo.nodes.length : 0;
    } catch { /* ignore */ }
    return {
      id: row.id,
      friendlyName: row.friendly_name,
      board: row.board,
      nodeCount,
    };
  });
}

/**
 * Get all node IDs registered in a site.
 */
export function getAllNodeIds(siteId: string): string[] {
  return queryAll<{ node_id: string }>(
    "SELECT node_id FROM node_ids WHERE site_id = ?",
    [siteId],
  ).map(r => r.node_id);
}

/**
 * Check for node ID conflicts within a site, excluding a specific system.
 * Returns node IDs that already exist in other systems of the same site.
 */
export function checkNodeIdConflicts(
  siteId: string, excludeSystemId: string, nodeIds: string[],
): string[] {
  if (nodeIds.length === 0) return [];

  const placeholders = nodeIds.map(() => "?").join(",");
  return queryAll<{ node_id: string }>(
    `SELECT node_id FROM node_ids
     WHERE site_id = ? AND system_id != ? AND node_id IN (${placeholders})`,
    [siteId, excludeSystemId, ...nodeIds],
  ).map(r => r.node_id);
}

/**
 * Insert a new system into a site. Caller is responsible for ensuring
 * node IDs don't conflict (use checkNodeIdConflicts first and remap if needed).
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
  const topologyJson = serializeTopology(system.topology);

  db.run("BEGIN TRANSACTION");
  try {
    db.run(
      `INSERT INTO systems (id, site_id, friendly_name, board, directory, topology, device_name)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [system.id, siteId, system.friendlyName, system.board, system.directory,
       topologyJson, system.deviceName],
    );

    // Register node IDs
    const topo = system.topology as { nodes?: Array<{ id?: string }> };
    const nodes = Array.isArray(topo?.nodes) ? topo.nodes : [];
    for (const node of nodes) {
      if (node.id) {
        db.run(
          "INSERT INTO node_ids (node_id, system_id, site_id) VALUES (?, ?, ?)",
          [node.id, system.id, siteId],
        );
      }
    }

    db.run("COMMIT");
    persist();
  } catch (e) {
    db.run("ROLLBACK");
    throw e;
  }
}

export function deleteSystem(siteId: string, systemId: string): void {
  getDb().run("DELETE FROM systems WHERE id = ? AND site_id = ?", [systemId, siteId]);
  persist();
}

// ---------------------------------------------------------------------------
// Links
// ---------------------------------------------------------------------------

export function listLinks(siteId: string): LinkRow[] {
  return queryAll<{
    id: string; site_id: string; from_system: string; from_node: string; from_port: string;
    to_system: string; to_node: string; to_port: string; label: string | null;
  }>(
    `SELECT id, site_id, from_system, from_node, from_port, to_system, to_node, to_port, label
     FROM links WHERE site_id = ?`,
    [siteId],
  ).map(r => ({
    id: r.id,
    siteId: r.site_id,
    fromSystem: r.from_system,
    fromNode: r.from_node,
    fromPort: r.from_port,
    toSystem: r.to_system,
    toNode: r.to_node,
    toPort: r.to_port,
    label: r.label,
  }));
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
