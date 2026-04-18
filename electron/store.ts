import { app } from "electron";
import * as fs from "node:fs";
import * as path from "node:path";
import * as crypto from "node:crypto";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";


// ---------------------------------------------------------------------------
// Schema versioning (for board YAML files)
// ---------------------------------------------------------------------------

export const SCHEMA_VERSION = 11;    // version this app writes

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
// Migration chain (for topology YAML — only used when loading templates)
// ---------------------------------------------------------------------------

type Migration = (data: Record<string, unknown>) => Record<string, unknown>;

const MIGRATIONS: Record<number, Migration> = {
  5: (data) => { data.schema = 6; data.automations = data.automations ?? []; return data; },
  6: (data) => {
    data.schema = 7;
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
    data.schema = 8;
    return data;
  },
  8: (data) => {
    data.schema = 9;
    // Rename handoff → interconnect
    const nodes = (data.nodes ?? []) as Array<Record<string, unknown>>;
    for (const n of nodes) {
      if (n.kind === 'handoff') n.kind = 'interconnect';
    }
    return data;
  },
  9: (data) => {
    data.schema = 10;
    // network config is optional — no data transform needed
    return data;
  },
  10: (data) => {
    data.schema = 11;
    // Level sensing decoupled from tank — strip level_pin and pump_rated from tank nodes.
    const nodes = (data.nodes ?? []) as Array<Record<string, unknown>>;
    for (const n of nodes) {
      if (n.kind === 'tank') {
        delete n.level_pin;
        delete n.pump_rated;
      }
    }
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
// ---------------------------------------------------------------------------

let _defaultsDir = "";

function storeRoot(): string {
  return path.join(app.getPath("userData"), "store");
}

function boardsDir(): string {
  return path.join(storeRoot(), "boards");
}

function defaultBoardsDir(): string {
  return path.join(_defaultsDir, "boards");
}

function defaultConfigsDir(): string {
  return path.join(_defaultsDir, "configs");
}

function templatesDir(): string {
  return path.join(storeRoot(), "templates");
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

/** True if the board model matches a bundled default. */
function isLibraryBoard(model: string): boolean {
  return fs.existsSync(path.join(defaultBoardsDir(), model));
}

// ---------------------------------------------------------------------------
// Initialization
// ---------------------------------------------------------------------------

function hashesPath(): string {
  return path.join(storeRoot(), "seed-hashes.json");
}

function fileHash(filePath: string): string {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

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
  kind: "board";
  id: string;
  label: string;
  action: "added" | "updated";
}

let _pendingChanges: SeedChange[] = [];

export function getSeedChanges(): SeedChange[] {
  return _pendingChanges;
}

export function applySeedChanges(id?: string): void {
  const hPath = hashesPath();
  const hashes: Record<string, string> = fs.existsSync(hPath)
    ? JSON.parse(fs.readFileSync(hPath, "utf-8"))
    : {};

  const toApply = id ? _pendingChanges.filter((c) => c.id === id) : [..._pendingChanges];

  for (const change of toApply) {
    const srcDir = path.join(defaultBoardsDir(), change.id);
    const destDir = path.join(boardsDir(), change.id);
    copyDirSync(srcDir, destDir);
    hashes[`board:${change.id}`] = dirHash(srcDir);
  }

  fs.writeFileSync(hPath, JSON.stringify(hashes, null, 2), "utf-8");
  const appliedIds = new Set(toApply.map((c) => c.id));
  _pendingChanges = _pendingChanges.filter((c) => !appliedIds.has(c.id));
}

export function dismissSeedChange(id: string): void {
  const hPath = hashesPath();
  const hashes: Record<string, string> = fs.existsSync(hPath)
    ? JSON.parse(fs.readFileSync(hPath, "utf-8"))
    : {};

  const change = _pendingChanges.find((c) => c.id === id);
  if (change) {
    hashes[`board:${change.id}`] = dirHash(path.join(defaultBoardsDir(), change.id));
    fs.writeFileSync(hPath, JSON.stringify(hashes, null, 2), "utf-8");
  }
  _pendingChanges = _pendingChanges.filter((c) => c.id !== id);
}

export function initStore(defaultsDir: string): void {
  _defaultsDir = defaultsDir;
  fs.mkdirSync(boardsDir(), { recursive: true });
  fs.mkdirSync(templatesDir(), { recursive: true });
  seedDefaults();
}

function seedDefaults(): void {
  const pending: SeedChange[] = [];
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
        const yamlPath = path.join(srcDir, "board.yaml");
        let label = d.name;
        if (fs.existsSync(yamlPath)) {
          const parsed = parseYaml(fs.readFileSync(yamlPath, "utf-8")) as Record<string, unknown>;
          label = (parsed.label as string) ?? d.name;
        }

        if (!existed) {
          copyDirSync(srcDir, destDir);
          newHashes[key] = hash;
        } else {
          pending.push({ kind: "board", id: d.name, label, action: "updated" });
        }
      }
    }
  }

  fs.writeFileSync(hPath, JSON.stringify(newHashes, null, 2), "utf-8");
  _pendingChanges = pending;
}

// ---------------------------------------------------------------------------
// Templates (read-only blueprints)
// ---------------------------------------------------------------------------

export interface TemplateListEntry {
  name: string;
  friendlyName: string;
  board: string;
  tanks: number;
  valves: number;
}

/**
 * List available templates. Reads from both bundled defaults and user templates dir.
 */
export function listTemplates(): TemplateListEntry[] {
  const result: TemplateListEntry[] = [];
  const seen = new Set<string>();

  const dirs = [defaultConfigsDir(), templatesDir()];
  for (const dir of dirs) {
    if (!fs.existsSync(dir)) continue;
    for (const f of fs.readdirSync(dir)) {
      if (!f.endsWith(".yaml")) continue;
      const name = f.replace(".yaml", "");
      if (seen.has(name)) continue;
      seen.add(name);

      try {
        const filePath = path.join(dir, f);
        const raw = fs.readFileSync(filePath, "utf-8");
        const parsed = parseYaml(raw) as Record<string, unknown>;
        const device = parsed.device as Record<string, unknown> | undefined;
        const nodes = Array.isArray(parsed.nodes)
          ? (parsed.nodes as Array<Record<string, unknown>>)
          : [];

        result.push({
          name,
          friendlyName: (device?.friendly_name as string) ?? name,
          board: (device?.board as string) ?? "unknown",
          tanks: nodes.filter((n) => n.kind === "tank").length,
          valves: nodes.filter((n) => n.kind === "valve").length,
        });
      } catch {
        // Skip broken template files
      }
    }
  }

  return result;
}

/**
 * Load a template topology. Applies schema migrations if needed.
 * Returns the full parsed topology data (device, nodes, pipes, etc.).
 */
export function loadTemplate(name: string): Record<string, unknown> {
  // Check user templates first, then bundled defaults
  const userPath = path.join(templatesDir(), `${name}.yaml`);
  const defaultPath = path.join(defaultConfigsDir(), `${name}.yaml`);

  const filePath = fs.existsSync(userPath) ? userPath : defaultPath;
  if (!fs.existsSync(filePath)) throw new Error(`Template not found: ${name}`);

  const raw = fs.readFileSync(filePath, "utf-8");
  const data = parseYaml(raw) as Record<string, unknown>;
  migrateIfNeeded(data, `templates/${name}.yaml`);
  return data;
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

function resolveBoardDir(idOrModel: string): string {
  const dir = path.join(boardsDir(), idOrModel);
  if (fs.existsSync(dir)) return dir;

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

  const model = (parsed.model as string) ?? path.basename(sourcePath);
  const dest = path.join(boardsDir(), model);
  copyDirSync(sourcePath, dest);
  return model;
}

// ---------------------------------------------------------------------------
// Output
// ---------------------------------------------------------------------------

const DEPRECATED_FILES = [
  "config/homeassistant/dashboards/pump.yaml",
];

export function writeOutput(files: Array<{ relativePath: string; content: string }>, outputDir: string): void {
  for (const stale of DEPRECATED_FILES) {
    const stalePath = path.join(outputDir, stale);
    if (fs.existsSync(stalePath)) {
      fs.unlinkSync(stalePath);
    }
  }

  for (const file of files) {
    const fullPath = path.join(outputDir, file.relativePath);

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

// ---------------------------------------------------------------------------
// Legacy import (one-time: old YAML sites/configs → structured data for DB)
// ---------------------------------------------------------------------------

export interface LegacyImportResult {
  sites: Array<{
    id: string;
    friendlyName: string;
    systems: Array<{
      id: string;
      friendlyName: string;
      board: string;
      directory: string | null;
      topology: Record<string, unknown>;
      position: { x: number; y: number };
    }>;
    links: Array<{
      id: string;
      fromSystem: string;
      fromNode: string;
      fromPort: string;
      toSystem: string;
      toNode: string;
      toPort: string;
      label: string | null;
    }>;
    haFiles: Array<{ filename: string; content: string }>;
  }>;
}

/**
 * Scan old store/ directories for legacy YAML sites and configs.
 * Returns structured data ready to insert into the DB.
 * Does NOT modify anything — caller decides what to import.
 */
export function scanLegacyData(): LegacyImportResult {
  const root = storeRoot();
  const oldSitesDir = path.join(root, "sites");
  const oldConfigsDir = path.join(root, "configs");
  const result: LegacyImportResult = { sites: [] };

  if (!fs.existsSync(oldSitesDir)) return result;

  for (const entry of fs.readdirSync(oldSitesDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const siteYamlPath = path.join(oldSitesDir, entry.name, "site.yaml");
    if (!fs.existsSync(siteYamlPath)) continue;

    try {
      const raw = parseYaml(fs.readFileSync(siteYamlPath, "utf-8")) as Record<string, unknown>;
      const siteId = entry.name;
      const friendlyName = (raw.friendly_name as string) ?? entry.name;

      const site: LegacyImportResult['sites'][0] = {
        id: siteId,
        friendlyName,
        systems: [],
        links: [],
        haFiles: [],
      };

      // Load referenced systems
      const placements = Array.isArray(raw.systems) ? raw.systems as Array<Record<string, unknown>> : [];
      for (const sp of placements) {
        const configName = sp.config as string;
        if (!configName) continue;
        const configPath = path.join(oldConfigsDir, `${configName}.yaml`);
        if (!fs.existsSync(configPath)) continue;

        try {
          const topoRaw = parseYaml(fs.readFileSync(configPath, "utf-8")) as Record<string, unknown>;
          const migrated = migrateIfNeeded(topoRaw, configPath);
          const device = migrated.device as Record<string, unknown> | undefined;
          const pos = sp.position as Record<string, number> | undefined;

          // Rename legacy 'handoff' kind → 'interconnect'
          const nodes = Array.isArray(migrated.nodes) ? migrated.nodes as Array<Record<string, unknown>> : [];
          for (const node of nodes) {
            if (node.kind === 'handoff') node.kind = 'interconnect';
          }

          site.systems.push({
            id: configName,
            friendlyName: (device?.friendly_name as string) ?? configName,
            board: (device?.board as string) ?? "unknown",
            directory: (device?.directory as string) ?? null,
            topology: {
              nodes,
              pipes: migrated.pipes ?? [],
              route_overrides: migrated.route_overrides ?? {},
              timing: migrated.timing ?? {},
              automations: migrated.automations ?? [],
              uart_buses: device?.uart_buses,
              io_providers: device?.io_providers,
            },
            position: { x: pos?.x ?? 0, y: pos?.y ?? 0 },
          });
        } catch {
          // Skip broken config
        }
      }

      // Parse links
      const oldLinks = Array.isArray(raw.links) ? raw.links as Array<Record<string, unknown>> : [];
      for (const link of oldLinks) {
        try {
          const fromRef = link.from as string;
          const toRef = link.to as string;
          if (!fromRef || !toRef) continue;

          const from = parseLegacyLinkRef(fromRef);
          const to = parseLegacyLinkRef(toRef);
          site.links.push({
            id: (link.id as string) ?? crypto.randomBytes(4).toString("hex"),
            fromSystem: from.config, fromNode: from.nodeId, fromPort: from.portId,
            toSystem: to.config, toNode: to.nodeId, toPort: to.portId,
            label: (link.label as string) ?? null,
          });
        } catch { /* skip broken link */ }
      }

      // HA files
      const haDir = path.join(oldSitesDir, entry.name, "ha");
      if (fs.existsSync(haDir)) {
        for (const haFile of fs.readdirSync(haDir)) {
          if (!haFile.endsWith(".yaml")) continue;
          try {
            site.haFiles.push({
              filename: haFile,
              content: fs.readFileSync(path.join(haDir, haFile), "utf-8"),
            });
          } catch { /* skip */ }
        }
      }

      if (site.systems.length > 0) {
        result.sites.push(site);
      }
    } catch {
      // Skip broken site dir
    }
  }

  return result;
}

/** Parse old "configName/nodeId:portId" link ref format. */
function parseLegacyLinkRef(ref: string): { config: string; nodeId: string; portId: string } {
  const slashIdx = ref.indexOf("/");
  if (slashIdx === -1) throw new Error(`Invalid legacy link ref: ${ref}`);
  const config = ref.slice(0, slashIdx);
  const rest = ref.slice(slashIdx + 1);
  const colonIdx = rest.indexOf(":");
  if (colonIdx === -1) throw new Error(`Invalid legacy link ref: ${ref}`);
  return { config, nodeId: rest.slice(0, colonIdx), portId: rest.slice(colonIdx + 1) };
}

/**
 * Check if legacy data exists in old store/ directories.
 */
export function hasLegacyData(): boolean {
  const oldSitesDir = path.join(storeRoot(), "sites");
  if (!fs.existsSync(oldSitesDir)) return false;
  return fs.readdirSync(oldSitesDir, { withFileTypes: true })
    .some(d => d.isDirectory() && fs.existsSync(path.join(oldSitesDir, d.name, "site.yaml")));
}
