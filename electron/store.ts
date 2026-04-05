import { app } from "electron";
import * as fs from "node:fs";
import * as path from "node:path";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";

// ---------------------------------------------------------------------------
// Schema versioning
// ---------------------------------------------------------------------------

export const SCHEMA_VERSION = 4;     // version this app writes

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

function checkSchema(data: Record<string, unknown>, filePath: string): void {
  const v = typeof data.schema === "number" ? data.schema : 0;
  if (v !== SCHEMA_VERSION) throw new SchemaError(filePath, v);
}

// ---------------------------------------------------------------------------
// Store paths
//
// Two layers:
//   1. defaults/ — bundled read-only seed data (boards + configs)
//   2. store/    — user-writable data (overrides defaults on name collision)
//
// Reads check store/ first, then fall back to defaults/.
// Writes always go to store/.
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
// Initialization — just store the defaults path, create user dirs
// ---------------------------------------------------------------------------

export function initStore(defaultsDir: string): void {
  _defaultsDir = defaultsDir;
  fs.mkdirSync(boardsDir(), { recursive: true });
  fs.mkdirSync(configsDir(), { recursive: true });
}

function copyDirSync(src: string, dest: string): void {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name);
    const d = path.join(dest, entry.name);
    if (entry.isDirectory()) copyDirSync(s, d);
    else fs.copyFileSync(s, d);
  }
}

// ---------------------------------------------------------------------------
// Boards
// ---------------------------------------------------------------------------

export interface BoardListEntry {
  id: string;
  model: string;
  label: string;
}

/** Merge board directories from defaults + store (store wins on collision). */
export function listBoards(): BoardListEntry[] {
  const entries = new Map<string, string>(); // id → dir path

  // Defaults first
  if (fs.existsSync(defaultBoardsDir())) {
    for (const d of fs.readdirSync(defaultBoardsDir(), { withFileTypes: true })) {
      if (d.isDirectory()) entries.set(d.name, path.join(defaultBoardsDir(), d.name));
    }
  }
  // Store overrides
  if (fs.existsSync(boardsDir())) {
    for (const d of fs.readdirSync(boardsDir(), { withFileTypes: true })) {
      if (d.isDirectory()) entries.set(d.name, path.join(boardsDir(), d.name));
    }
  }

  return [...entries.entries()]
    .map(([id, dir]) => {
      const yamlPath = path.join(dir, "board.yaml");
      if (!fs.existsSync(yamlPath)) return null;
      const raw = fs.readFileSync(yamlPath, "utf-8");
      const parsed = parseYaml(raw) as Record<string, unknown>;
      return {
        id,
        model: (parsed.model as string) ?? id,
        label: (parsed.label as string) ?? id,
      };
    })
    .filter((x): x is BoardListEntry => x !== null);
}

/** Resolve a board directory: store first, then defaults. */
function resolveBoardDir(model: string): string {
  const storeDir = path.join(boardsDir(), model);
  if (fs.existsSync(storeDir)) return storeDir;
  const defaultDir = path.join(defaultBoardsDir(), model);
  if (fs.existsSync(defaultDir)) return defaultDir;
  throw new Error(`Board not found: ${model}`);
}

export function loadBoard(model: string): { board: Record<string, unknown>; svg: string | null } {
  const dir = resolveBoardDir(model);
  const yamlPath = path.join(dir, "board.yaml");
  const raw = fs.readFileSync(yamlPath, "utf-8");
  const board = parseYaml(raw) as Record<string, unknown>;
  checkSchema(board, `boards/${model}/board.yaml`);

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
  checkSchema(parsed, yamlPath);

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
}

/** Merge config files from defaults + store (store wins on collision). */
export function listConfigs(): ConfigListEntry[] {
  const files = new Map<string, string>(); // name → file path

  // Defaults first
  if (fs.existsSync(defaultConfigsDir())) {
    for (const f of fs.readdirSync(defaultConfigsDir())) {
      if (f.endsWith(".yaml")) files.set(f.replace(".yaml", ""), path.join(defaultConfigsDir(), f));
    }
  }
  // Store overrides
  if (fs.existsSync(configsDir())) {
    for (const f of fs.readdirSync(configsDir())) {
      if (f.endsWith(".yaml")) files.set(f.replace(".yaml", ""), path.join(configsDir(), f));
    }
  }

  return [...files.entries()].map(([name, filePath]) => {
    const raw = fs.readFileSync(filePath, "utf-8");
    const parsed = parseYaml(raw) as Record<string, unknown>;
    const device = parsed.device as Record<string, unknown> | undefined;

    const isV3 = Array.isArray(parsed.nodes);
    let tankCount: number;
    let valveCount: number;

    if (isV3) {
      const nodes = parsed.nodes as Array<Record<string, unknown>>;
      const pipes = Array.isArray(parsed.pipes) ? parsed.pipes as Array<Record<string, unknown>> : [];
      const components = pipes.flatMap(
        (p) => Array.isArray(p.components) ? p.components as Array<Record<string, unknown>> : []
      );
      tankCount = nodes.filter((n) => n.kind === "tank").length;
      valveCount = components.filter((c) => c.kind === "valve").length;
    } else {
      tankCount = Array.isArray(parsed.tanks) ? parsed.tanks.length : 0;
      valveCount = Array.isArray(parsed.valves) ? parsed.valves.length : 0;
    }

    return {
      name,
      deviceName: (device?.name as string) ?? name,
      friendlyName: (device?.friendly_name as string) ?? name,
      board: (device?.board as string) ?? "unknown",
      tanks: tankCount,
      valves: valveCount,
      routes: isV3 ? 0 : (Array.isArray(parsed.routes) ? parsed.routes.length : 0),
    };
  });
}

/** Resolve a config file: store first, then defaults. */
function resolveConfigPath(name: string): string {
  const storePath = path.join(configsDir(), `${name}.yaml`);
  if (fs.existsSync(storePath)) return storePath;
  const defaultPath = path.join(defaultConfigsDir(), `${name}.yaml`);
  if (fs.existsSync(defaultPath)) return defaultPath;
  throw new Error(`Config not found: ${name}`);
}

export function loadConfig(name: string): Record<string, unknown> {
  const filePath = resolveConfigPath(name);
  const raw = fs.readFileSync(filePath, "utf-8");
  const data = parseYaml(raw) as Record<string, unknown>;
  checkSchema(data, `configs/${name}.yaml`);

  return data;
}

/** Always writes to the store directory. */
export function saveConfig(name: string, data: unknown): void {
  fs.mkdirSync(configsDir(), { recursive: true });
  const filePath = path.join(configsDir(), `${name}.yaml`);

  const obj = data as Record<string, unknown>;
  if (!obj.schema) obj.schema = SCHEMA_VERSION;

  const yaml = stringifyYaml(obj, { indent: 2, lineWidth: 0 });
  fs.writeFileSync(filePath, yaml, "utf-8");
}

export function deleteConfig(name: string): void {
  const filePath = path.join(configsDir(), `${name}.yaml`);
  if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
}

export function importConfig(sourcePath: string): string {
  const raw = fs.readFileSync(sourcePath, "utf-8");
  const parsed = parseYaml(raw) as Record<string, unknown>;
  checkSchema(parsed, sourcePath);

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

export function writeOutput(files: Array<{ relativePath: string; content: string }>, outputDir: string): void {
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
