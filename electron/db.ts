import initSqlJs, { type Database } from "sql.js";
import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { SCHEMA_VERSION } from "./store.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface GenerationMeta {
  id: number;
  version: string;
  configName: string;
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

const DB_VERSION = 1;

const MIGRATIONS: Record<number, string> = {
  0: `
    CREATE TABLE generations (
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
    CREATE INDEX idx_generations_config ON generations (config_name, id DESC);
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
function queryOne<T>(sql: string, params: unknown[] = []): T | null {
  const rows = queryAll<T>(sql, params);
  return rows[0] ?? null;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** SHA-256 hex digest of the topology + board JSON (deterministic input hash). */
export function inputChecksum(topology: unknown, board: unknown): string {
  const hash = crypto.createHash("sha256");
  hash.update(JSON.stringify(topology));
  hash.update(JSON.stringify(board));
  return hash.digest("hex").slice(0, 16);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Create a new generation record. Returns `null` if the latest generation
 * for this config already has the same input checksum (nothing changed).
 */
export function createGeneration(
  configName: string,
  topology: unknown,
  board: unknown,
): { version: string; id: number } | null {
  const db = getDb();
  const checksum = inputChecksum(topology, board);

  // Skip if the most recent generation for this config has identical inputs
  const latest = queryOne<{ checksum: string }>(
    `SELECT checksum FROM generations WHERE config_name = ? ORDER BY id DESC LIMIT 1`,
    [configName],
  );
  if (latest && latest.checksum === checksum) return null;

  const version = crypto.randomBytes(4).toString("hex");
  const topologyJson = JSON.stringify(topology);
  const boardJson = JSON.stringify(board);
  db.run(
    `INSERT INTO generations (version, config_name, schema_version, topology, board, checksum)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [version, configName, SCHEMA_VERSION, topologyJson, boardJson, checksum],
  );

  const row = db.exec("SELECT last_insert_rowid() AS id");
  const id = Number(row[0].values[0][0]);
  persist();
  return { version, id };
}

export function finalizeGeneration(id: number, fileCount: number): void {
  getDb().run(`UPDATE generations SET file_count = ? WHERE id = ?`, [fileCount, id]);
  persist();
}

export function listGenerations(configName: string): GenerationMeta[] {
  return queryAll<GenerationMeta>(
    `SELECT id, version, config_name AS configName, schema_version AS schemaVersion,
            file_count AS fileCount, checksum, created_at AS createdAt
     FROM generations
     WHERE config_name = ?
     ORDER BY id DESC`,
    [configName],
  );
}

export function loadGeneration(id: number): GenerationSnapshot | null {
  return queryOne<GenerationSnapshot>(
    `SELECT id, version, config_name AS configName, schema_version AS schemaVersion,
            file_count AS fileCount, checksum, created_at AS createdAt,
            topology, board
     FROM generations WHERE id = ?`,
    [id],
  );
}

export function loadGenerationByVersion(version: string): GenerationSnapshot | null {
  return queryOne<GenerationSnapshot>(
    `SELECT id, version, config_name AS configName, schema_version AS schemaVersion,
            file_count AS fileCount, checksum, created_at AS createdAt,
            topology, board
     FROM generations WHERE version = ?`,
    [version],
  );
}

export function pruneGenerations(configName: string, keepCount: number = 10): number {
  const db = getDb();
  const before = queryAll<{ id: number }>(
    "SELECT id FROM generations WHERE config_name = ?",
    [configName],
  ).length;

  db.run(
    `DELETE FROM generations
     WHERE config_name = ?
       AND id NOT IN (
         SELECT id FROM generations
         WHERE config_name = ?
         ORDER BY id DESC
         LIMIT ?
       )`,
    [configName, configName, keepCount],
  );

  const after = queryAll<{ id: number }>(
    "SELECT id FROM generations WHERE config_name = ?",
    [configName],
  ).length;

  persist();
  return before - after;
}
