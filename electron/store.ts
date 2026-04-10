import { app } from "electron";
import * as fs from "node:fs";
import * as path from "node:path";
import * as crypto from "node:crypto";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";


// ---------------------------------------------------------------------------
// Schema versioning
// ---------------------------------------------------------------------------

export const SCHEMA_VERSION = 8;     // version this app writes

export class SchemaError extends Error {
  constructor(
    public file: string,
    public fileVersion: number,
  ) {
    const msg =
      fileVersion < SCHEMA_VERSION
        ? `"${file}" uses schema v${fileVersion}, but this app requires v${SCHEMA_VERSION}. Re-create the file.`
        : `"${file}" uses schema v${fileVersion}, but this app only supports v${SCHEMA_VERSION}. Update the app.`;
    super(msg);
    this.name = "SchemaError";
  }
}

// ---------------------------------------------------------------------------
// Migration chain
// ---------------------------------------------------------------------------
// Add migrations here when breaking structural changes are made.
// Each function transforms data from version N to N+1.
// New additive node kinds do NOT require a migration — only structural changes.

type Migration = (data: Record<string, unknown>) => Record<string, unknown>;

const MIGRATIONS: Record<number, Migration> = {
  5: (data) => { data.schema = 6; data.automations = data.automations ?? []; return data; },
  6: (data) => {
    data.schema = 7;
    // Move automation conditions to route_overrides (firmware-enforced)
    const overrides = (data.route_overrides ?? {}) as Record<string, Record<string, unknown>>;
    const automations = (data.automations ?? []) as Array<Record<string, unknown>>;
    for (const a of automations) {
      const cond = a.conditions as Record<string, unknown> | undefined;
      if (!cond) continue;
      const routeKey = a.route as string;
      if (!routeKey) continue;
      const ov = overrides[routeKey] ?? {};
      if (cond.source_min_level != null && ov.source_min_level == null) {
        ov.source_min_level = cond.source_min_level;
      }
      if (cond.dest_max_level != null && ov.dest_max_level == null) {
        ov.dest_max_level = cond.dest_max_level;
      }
      overrides[routeKey] = ov;
      delete a.conditions;
    }
    data.route_overrides = overrides;
    return data;
  },
  7: (data) => {
    // Level triggers now support 'node' (topology ref) alongside 'entity' (raw HA).
    // Existing 'entity' values are preserved — no auto-conversion needed.
    data.schema = 8;
    return data;
  },
};

function migrateIfNeeded(data: Record<string, unknown>, filePath: string): Record<string, unknown> {
  let v = typeof data.schema === "number" ? data.schema : 0;
  while (MIGRATIONS[v]) {
    data = MIGRATIONS[v](data);
    v = typeof data.schema === "number" ? data.schema : v + 1;
  }
  if (v !== SCHEMA_VERSION) throw new SchemaError(filePath, v);
  return data;
}


// ---------------------------------------------------------------------------
// Store paths
//
// defaults/ contains bundled seed data (boards + configs).
// store/    is the single source of truth at runtime.
//
// On init, defaults are seeded into store (missing or stale entries replaced).
// All reads and writes go through store/ only.
// ---------------------------------------------------------------------------

let _defaultsDir = "";

function storeRoot(): string {
  return path.join(app.getPath("userData"), "store");
}

function boardsDir(): string {
  return path.join(storeRoot(), "boards");
}

function configsDir(): string {
  return path.join(storeRoot(), "configs");
}

function defaultBoardsDir(): string {
  return path.join(_defaultsDir, "boards");
}

function defaultConfigsDir(): string {
  return path.join(_defaultsDir, "configs");
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function copyDirSync(src: string, dest: string): void {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name);
    const d = path.join(dest, entry.name);
    if (entry.isDirectory()) copyDirSync(s, d);
    else fs.copyFileSync(s, d);
  }
}

/** True if the config name matches a bundled default. */
function isLibraryConfig(name: string): boolean {
  return fs.existsSync(path.join(defaultConfigsDir(), `${name}.yaml`));
}

/** True if the board model matches a bundled default. */
function isLibraryBoard(model: string): boolean {
  return fs.existsSync(path.join(defaultBoardsDir(), model));
}

/** Generate a unique name that doesn't collide with existing store entries. */
function uniqueName(base: string, dir: string, ext: string): string {
  let candidate = `${base}-copy`;
  let i = 1;
  while (fs.existsSync(path.join(dir, `${candidate}${ext}`))) {
    candidate = `${base}-copy-${++i}`;
  }
  return candidate;
}

// ---------------------------------------------------------------------------
// Initialization — seed defaults into store, then store is the only source
// ---------------------------------------------------------------------------

function templatesDir(): string {
  return path.join(storeRoot(), "templates");
}

function hashesPath(): string {
  return path.join(storeRoot(), "seed-hashes.json");
}

/** SHA-256 hash of a file's contents. */
function fileHash(filePath: string): string {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

/** Recursively hash all files in a directory into a single digest. */
function dirHash(dirPath: string): string {
  const hash = crypto.createHash("sha256");
  const entries = fs.readdirSync(dirPath, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));
  for (const entry of entries) {
    const full = path.join(dirPath, entry.name);
    if (entry.isDirectory()) hash.update(dirHash(full));
    else hash.update(fs.readFileSync(full));
  }
  return hash.digest("hex");
}

export interface SeedChange {
  kind: "board" | "config";
  id: string;
  label: string;
  action: "added" | "updated";
}

let _pendingChanges: SeedChange[] = [];

/** Returns pending default updates that require user confirmation. */
export function getSeedChanges(): SeedChange[] {
  return _pendingChanges;
}

/**
 * Apply one or all pending seed changes (user confirmed the overwrite).
 * If no id is given, applies all pending changes.
 */
export function applySeedChanges(id?: string): void {
  const hPath = hashesPath();
  const hashes: Record<string, string> = fs.existsSync(hPath)
    ? JSON.parse(fs.readFileSync(hPath, "utf-8"))
    : {};

  const toApply = id ? _pendingChanges.filter((c) => c.id === id) : [..._pendingChanges];

  for (const change of toApply) {
    if (change.kind === "board") {
      const srcDir = path.join(defaultBoardsDir(), change.id);
      const destDir = path.join(boardsDir(), change.id);
      copyDirSync(srcDir, destDir);
      hashes[`board:${change.id}`] = dirHash(srcDir);
    } else {
      const srcPath = path.join(defaultConfigsDir(), `${change.id}.yaml`);
      const destPath = path.join(configsDir(), `${change.id}.yaml`);
      fs.copyFileSync(srcPath, destPath);
      hashes[`config:${change.id}.yaml`] = fileHash(srcPath);
    }
  }

  fs.writeFileSync(hPath, JSON.stringify(hashes, null, 2), "utf-8");

  // Remove applied entries from pending list
  const appliedIds = new Set(toApply.map((c) => c.id));
  _pendingChanges = _pendingChanges.filter((c) => !appliedIds.has(c.id));
}

/** Dismiss a pending change without applying it. */
export function dismissSeedChange(id: string): void {
  // Update hash to current bundled version so it won't prompt again
  const hPath = hashesPath();
  const hashes: Record<string, string> = fs.existsSync(hPath)
    ? JSON.parse(fs.readFileSync(hPath, "utf-8"))
    : {};

  const change = _pendingChanges.find((c) => c.id === id);
  if (change) {
    if (change.kind === "board") {
      hashes[`board:${change.id}`] = dirHash(path.join(defaultBoardsDir(), change.id));
    } else {
      hashes[`config:${change.id}.yaml`] = fileHash(path.join(defaultConfigsDir(), `${change.id}.yaml`));
    }
    fs.writeFileSync(hPath, JSON.stringify(hashes, null, 2), "utf-8");
  }
  _pendingChanges = _pendingChanges.filter((c) => c.id !== id);
}

export function initStore(defaultsDir: string): void {
  _defaultsDir = defaultsDir;
  fs.mkdirSync(boardsDir(), { recursive: true });
  fs.mkdirSync(configsDir(), { recursive: true });
  fs.mkdirSync(templatesDir(), { recursive: true });
  seedDefaults();
}

/**
 * Seed defaults into store.
 * - New entries (not yet in store) are copied automatically.
 * - Changed entries (hash mismatch) are queued as pending — the user
 *   must confirm before they overwrite the store copy.
 */
function seedDefaults(): void {
  const pending: SeedChange[] = [];

  // Load previous hashes
  const hPath = hashesPath();
  const prevHashes: Record<string, string> = fs.existsSync(hPath)
    ? JSON.parse(fs.readFileSync(hPath, "utf-8"))
    : {};
  const newHashes: Record<string, string> = { ...prevHashes };

  // Seed boards
  if (fs.existsSync(defaultBoardsDir())) {
    for (const d of fs.readdirSync(defaultBoardsDir(), { withFileTypes: true })) {
      if (!d.isDirectory()) continue;
      const srcDir = path.join(defaultBoardsDir(), d.name);
      const destDir = path.join(boardsDir(), d.name);
      const key = `board:${d.name}`;
      const hash = dirHash(srcDir);
      const existed = fs.existsSync(destDir);

      if (hash !== prevHashes[key]) {
        // Read label from YAML for user-friendly notification
        const yamlPath = path.join(srcDir, "board.yaml");
        let label = d.name;
        if (fs.existsSync(yamlPath)) {
          const parsed = parseYaml(fs.readFileSync(yamlPath, "utf-8")) as Record<string, unknown>;
          label = (parsed.label as string) ?? d.name;
        }

        if (!existed) {
          // New board — auto-seed, no prompt needed
          copyDirSync(srcDir, destDir);
          newHashes[key] = hash;
        } else {
          // Changed board — queue for user confirmation
          pending.push({ kind: "board", id: d.name, label, action: "updated" });
        }
      }
    }
  }

  // Seed configs
  if (fs.existsSync(defaultConfigsDir())) {
    for (const f of fs.readdirSync(defaultConfigsDir())) {
      if (!f.endsWith(".yaml")) continue;
      const srcPath = path.join(defaultConfigsDir(), f);
      const destPath = path.join(configsDir(), f);
      const key = `config:${f}`;
      const hash = fileHash(srcPath);
      const existed = fs.existsSync(destPath);

      if (hash !== prevHashes[key]) {
        const name = f.replace(".yaml", "");
        if (!existed) {
          // New config — auto-seed
          fs.copyFileSync(srcPath, destPath);
          newHashes[key] = hash;
        } else {
          // Changed config — queue for user confirmation
          pending.push({ kind: "config", id: name, label: name, action: "updated" });
        }
      }
    }
  }

  // Persist hashes (only for auto-seeded new entries)
  fs.writeFileSync(hPath, JSON.stringify(newHashes, null, 2), "utf-8");
  _pendingChanges = pending;
}

/**
 * Read a user-editable template by name. Returns undefined if not found.
 */
export function getTemplate(name: string): string | undefined {
  const p = path.join(templatesDir(), name);
  return fs.existsSync(p) ? fs.readFileSync(p, "utf-8") : undefined;
}

// ---------------------------------------------------------------------------
// Boards
// ---------------------------------------------------------------------------

export interface BoardListEntry {
  id: string;
  model: string;
  label: string;
  library: boolean;
}

export function listBoards(): BoardListEntry[] {
  if (!fs.existsSync(boardsDir())) return [];

  return fs.readdirSync(boardsDir(), { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => {
      const yamlPath = path.join(boardsDir(), d.name, "board.yaml");
      if (!fs.existsSync(yamlPath)) return null;
      const raw = fs.readFileSync(yamlPath, "utf-8");
      const parsed = parseYaml(raw) as Record<string, unknown>;
      return {
        id: d.name,
        model: (parsed.model as string) ?? d.name,
        label: (parsed.label as string) ?? d.name,
        library: isLibraryBoard(d.name),
      };
    })
    .filter((x): x is BoardListEntry => x !== null);
}

/**
 * Resolve a board directory by ID (directory name) or model name.
 * First tries a direct directory match, then falls back to scanning
 * board directories for a matching `model` field in their YAML.
 */
function resolveBoardDir(idOrModel: string): string {
  // Direct match by directory name (the canonical ID)
  const dir = path.join(boardsDir(), idOrModel);
  if (fs.existsSync(dir)) return dir;

  // Fallback: scan for a board whose YAML `model` field matches
  const base = boardsDir();
  if (fs.existsSync(base)) {
    for (const d of fs.readdirSync(base, { withFileTypes: true })) {
      if (!d.isDirectory()) continue;
      const yamlPath = path.join(base, d.name, "board.yaml");
      if (!fs.existsSync(yamlPath)) continue;
      const raw = fs.readFileSync(yamlPath, "utf-8");
      const parsed = parseYaml(raw) as Record<string, unknown>;
      if (parsed.model === idOrModel) return path.join(base, d.name);
    }
  }

  throw new Error(`Board not found: ${idOrModel}`);
}

export function loadBoard(idOrModel: string): { board: Record<string, unknown>; svg: string | null } {
  const dir = resolveBoardDir(idOrModel);
  const id = path.basename(dir);
  const yamlPath = path.join(dir, "board.yaml");
  const raw = fs.readFileSync(yamlPath, "utf-8");
  const board = parseYaml(raw) as Record<string, unknown>;
  migrateIfNeeded(board, `boards/${id}/board.yaml`);

  // Inject canonical directory ID so downstream code never guesses
  board.id = id;

  const svgField = (board.svg as string) ?? "board.svg";
  const svgPath = path.join(dir, svgField);
  const svg = fs.existsSync(svgPath) ? fs.readFileSync(svgPath, "utf-8") : null;

  return { board, svg };
}

export function importBoard(sourcePath: string): string {
  const yamlPath = path.join(sourcePath, "board.yaml");
  if (!fs.existsSync(yamlPath)) throw new Error("No board.yaml found in selected directory");

  const raw = fs.readFileSync(yamlPath, "utf-8");
  const parsed = parseYaml(raw) as Record<string, unknown>;
  migrateIfNeeded(parsed, yamlPath);

  const model = (parsed.model as string) ?? path.basename(sourcePath);
  const dest = path.join(boardsDir(), model);
  copyDirSync(sourcePath, dest);
  return model;
}

// ---------------------------------------------------------------------------
// Configs
// ---------------------------------------------------------------------------

export interface ConfigListEntry {
  name: string;
  deviceName: string;
  friendlyName: string;
  board: string;
  tanks: number;
  valves: number;
  routes: number;
  library: boolean;
}

export function listConfigs(): ConfigListEntry[] {
  if (!fs.existsSync(configsDir())) return [];

  return fs.readdirSync(configsDir())
    .filter((f) => f.endsWith(".yaml"))
    .map((f) => {
      const name = f.replace(".yaml", "");
      const filePath = path.join(configsDir(), f);
      const raw = fs.readFileSync(filePath, "utf-8");
      const parsed = parseYaml(raw) as Record<string, unknown>;
      const device = parsed.device as Record<string, unknown> | undefined;
      const nodes = Array.isArray(parsed.nodes)
        ? (parsed.nodes as Array<Record<string, unknown>>)
        : [];
      const overrides =
        typeof parsed.route_overrides === "object" && parsed.route_overrides !== null
          ? (parsed.route_overrides as Record<string, unknown>)
          : {};

      return {
        name,
        deviceName: (device?.name as string) ?? name,
        friendlyName: (device?.friendly_name as string) ?? name,
        board: (device?.board as string) ?? "unknown",
        tanks: nodes.filter((n) => n.kind === "tank").length,
        valves: nodes.filter((n) => n.kind === "valve").length,
        routes: Object.keys(overrides).length,
        library: isLibraryConfig(name),
      };
    });
}

function resolveConfigPath(name: string): string {
  const filePath = path.join(configsDir(), `${name}.yaml`);
  if (fs.existsSync(filePath)) return filePath;
  throw new Error(`Config not found: ${name}`);
}

export function loadConfig(name: string): Record<string, unknown> {
  const filePath = resolveConfigPath(name);
  const raw = fs.readFileSync(filePath, "utf-8");
  const data = parseYaml(raw) as Record<string, unknown>;
  migrateIfNeeded(data, `configs/${name}.yaml`);
  return data;
}

/** Writes a user config to store. Throws if name is a bundled template. */
export function saveConfig(name: string, data: unknown): void {
  if (isLibraryConfig(name)) {
    throw new Error(`Cannot overwrite template "${name}". Duplicate it first.`);
  }
  fs.mkdirSync(configsDir(), { recursive: true });

  const filePath = path.join(configsDir(), `${name}.yaml`);
  const obj = data as Record<string, unknown>;
  if (!obj.schema) obj.schema = SCHEMA_VERSION;

  const yaml = stringifyYaml(obj, { indent: 2, lineWidth: 0 });
  fs.writeFileSync(filePath, yaml, "utf-8");
}

/** Copy a config (template or user) to a new user config name. Returns the saved name. */
export function duplicateConfig(sourceName: string, newName: string): string {
  const sourceData = loadConfig(sourceName);
  const finalName = isLibraryConfig(newName)
    ? uniqueName(newName, configsDir(), ".yaml")
    : newName;

  // Ensure the destination doesn't collide with an existing file
  const destPath = path.join(configsDir(), `${finalName}.yaml`);
  if (fs.existsSync(destPath) && !isLibraryConfig(finalName)) {
    throw new Error(`Config "${finalName}" already exists.`);
  }

  const yaml = stringifyYaml(sourceData, { indent: 2, lineWidth: 0 });
  fs.writeFileSync(destPath, yaml, "utf-8");
  return finalName;
}

/** Deletes a user config. Throws if name is a bundled template. */
export function deleteConfig(name: string): void {
  if (isLibraryConfig(name)) {
    throw new Error(`Cannot delete template "${name}". Templates are re-seeded on startup.`);
  }
  const filePath = path.join(configsDir(), `${name}.yaml`);
  if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
}

export function importConfig(sourcePath: string): string {
  const raw = fs.readFileSync(sourcePath, "utf-8");
  const parsed = parseYaml(raw) as Record<string, unknown>;
  migrateIfNeeded(parsed, sourcePath);

  const device = parsed.device as Record<string, unknown> | undefined;
  const boardId = device?.board as string | undefined;
  if (boardId) {
    try { resolveBoardDir(boardId); }
    catch { throw new Error(`Board "${boardId}" not found. Import the board definition first.`); }
  }

  const name = path.basename(sourcePath, ".yaml");
  const dest = path.join(configsDir(), `${name}.yaml`);
  fs.copyFileSync(sourcePath, dest);
  return name;
}

export function exportConfig(name: string, destPath: string): void {
  const srcPath = resolveConfigPath(name);
  fs.copyFileSync(srcPath, destPath);
}

// ---------------------------------------------------------------------------
// Output
// ---------------------------------------------------------------------------

// Stale files to clean up from previous generator versions.
const DEPRECATED_FILES = [
  "config/homeassistant/dashboards/pump.yaml",
];

export function writeOutput(files: Array<{ relativePath: string; content: string }>, outputDir: string): void {
  // Remove known stale files from previous generations
  for (const stale of DEPRECATED_FILES) {
    const stalePath = path.join(outputDir, stale);
    if (fs.existsSync(stalePath)) {
      fs.unlinkSync(stalePath);
    }
  }

  for (const file of files) {
    const fullPath = path.join(outputDir, file.relativePath);

    // Don't overwrite secrets if they already exist (preserves user credentials)
    if (file.relativePath.endsWith("secrets.yaml") && fs.existsSync(fullPath)) {
      continue;
    }

    const dir = path.dirname(fullPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(fullPath, file.content, "utf-8");
  }
}

export function getStorePath(): string {
  return storeRoot();
}

export function getOutputDir(): string {
  const dir = path.join(app.getPath("home"), ".majiflow", "output");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}
