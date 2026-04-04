import { app } from "electron";
import * as fs from "node:fs";
import * as path from "node:path";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";

// ---------------------------------------------------------------------------
// Schema versioning
// ---------------------------------------------------------------------------

export const SCHEMA_VERSION = 1;     // version this app writes
export const MIN_SCHEMA_VERSION = 1; // oldest version this app can read

export class SchemaError extends Error {
  constructor(
    public file: string,
    public fileVersion: number,
    public reason: "too_old" | "too_new"
  ) {
    const msg =
      reason === "too_old"
        ? `"${file}" uses schema v${fileVersion}, but this app requires v${MIN_SCHEMA_VERSION}+. Re-create the file or migrate it.`
        : `"${file}" uses schema v${fileVersion}, but this app only supports up to v${SCHEMA_VERSION}. Update the app.`;
    super(msg);
    this.name = "SchemaError";
  }
}

function checkSchema(data: Record<string, unknown>, filePath: string): void {
  const v = typeof data.schema === "number" ? data.schema : 0;
  if (v < MIN_SCHEMA_VERSION) throw new SchemaError(filePath, v, "too_old");
  if (v > SCHEMA_VERSION) throw new SchemaError(filePath, v, "too_new");
}

// ---------------------------------------------------------------------------
// Store paths
// ---------------------------------------------------------------------------

function storeRoot(): string {
  return path.join(app.getPath("userData"), "store");
}

function boardsDir(): string {
  return path.join(storeRoot(), "boards");
}

function configsDir(): string {
  return path.join(storeRoot(), "configs");
}

// ---------------------------------------------------------------------------
// Initialization — copy bundled defaults on first run
// ---------------------------------------------------------------------------

export function initStore(defaultsDir: string): void {
  const root = storeRoot();
  const isFirstRun = !fs.existsSync(root);

  fs.mkdirSync(boardsDir(), { recursive: true });
  fs.mkdirSync(configsDir(), { recursive: true });

  if (isFirstRun) {
    // Copy bundled boards
    const bundledBoards = path.join(defaultsDir, "boards");
    if (fs.existsSync(bundledBoards)) {
      for (const entry of fs.readdirSync(bundledBoards, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        const dest = path.join(boardsDir(), entry.name);
        if (!fs.existsSync(dest)) {
          copyDirSync(path.join(bundledBoards, entry.name), dest);
        }
      }
    }

    // Copy bundled configs
    const bundledConfigs = path.join(defaultsDir, "configs");
    if (fs.existsSync(bundledConfigs)) {
      for (const file of fs.readdirSync(bundledConfigs)) {
        if (!file.endsWith(".yaml")) continue;
        const dest = path.join(configsDir(), file);
        if (!fs.existsSync(dest)) {
          fs.copyFileSync(path.join(bundledConfigs, file), dest);
        }
      }
    }
  }
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

export function listBoards(): BoardListEntry[] {
  const dir = boardsDir();
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => {
      const yamlPath = path.join(dir, d.name, "board.yaml");
      if (!fs.existsSync(yamlPath)) return null;
      const raw = fs.readFileSync(yamlPath, "utf-8");
      const parsed = parseYaml(raw) as Record<string, unknown>;
      return {
        id: d.name,
        model: (parsed.model as string) ?? d.name,
        label: (parsed.label as string) ?? d.name,
      };
    })
    .filter((x): x is BoardListEntry => x !== null);
}

export function loadBoard(model: string): { board: Record<string, unknown>; svg: string | null } {
  const dir = path.join(boardsDir(), model);
  if (!fs.existsSync(dir)) throw new Error(`Board not found: ${model}`);

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
  // sourcePath is a directory containing board.yaml + optional SVG
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

export function listConfigs(): ConfigListEntry[] {
  const dir = configsDir();
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".yaml"))
    .map((f) => {
      const raw = fs.readFileSync(path.join(dir, f), "utf-8");
      const parsed = parseYaml(raw) as Record<string, unknown>;
      const device = parsed.device as Record<string, unknown> | undefined;
      const name = f.replace(".yaml", "");
      return {
        name,
        deviceName: (device?.name as string) ?? name,
        friendlyName: (device?.friendly_name as string) ?? name,
        board: (device?.board as string) ?? "unknown",
        tanks: Array.isArray(parsed.tanks) ? parsed.tanks.length : 0,
        valves: Array.isArray(parsed.valves) ? parsed.valves.length : 0,
        routes: Array.isArray(parsed.routes) ? parsed.routes.length : 0,
      };
    });
}

export function loadConfig(name: string): Record<string, unknown> {
  const filePath = path.join(configsDir(), `${name}.yaml`);
  if (!fs.existsSync(filePath)) throw new Error(`Config not found: ${name}`);
  const raw = fs.readFileSync(filePath, "utf-8");
  const data = parseYaml(raw) as Record<string, unknown>;
  checkSchema(data, `configs/${name}.yaml`);
  return data;
}

export function saveConfig(name: string, data: unknown): void {
  fs.mkdirSync(configsDir(), { recursive: true });
  const filePath = path.join(configsDir(), `${name}.yaml`);

  // Ensure schema version is set
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

  // Validate board exists
  const device = parsed.device as Record<string, unknown> | undefined;
  const boardId = device?.board as string | undefined;
  if (boardId) {
    const boardDir = path.join(boardsDir(), boardId);
    if (!fs.existsSync(boardDir)) {
      throw new Error(`Board "${boardId}" not found. Import the board definition first.`);
    }
  }

  const name = path.basename(sourcePath, ".yaml");
  const dest = path.join(configsDir(), `${name}.yaml`);
  fs.copyFileSync(sourcePath, dest);
  return name;
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
  const dir = path.join(app.getPath("userData"), "output");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}
