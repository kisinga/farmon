import { ipcMain, BrowserWindow } from "electron";
import { spawn } from "node:child_process";
import * as path from "node:path";
import { ManifestSchema } from "./lib/schema.js";
import { validate } from "./lib/validate.js";
import { generateAll } from "./lib/generate.js";
import { BoardDefSchema } from "./lib/board.js";
import * as store from "./store.js";

// ---------------------------------------------------------------------------
// ESPHome detection
// ---------------------------------------------------------------------------

function findEsphome(): string | null {
  const { execSync } = require("node:child_process");
  try {
    return execSync("which esphome", { encoding: "utf-8" }).trim() || null;
  } catch {
    return null;
  }
}

let esphomePath: string | null = null;

// ---------------------------------------------------------------------------
// IPC handlers
// ---------------------------------------------------------------------------

export function registerIpcHandlers() {
  esphomePath = findEsphome();

  // --- Boards ---

  ipcMain.handle("board:list", async () => store.listBoards());

  ipcMain.handle("board:load", async (_event, model: string) =>
    store.loadBoard(model)
  );

  ipcMain.handle("board:import", async (_event, dirPath: string) =>
    store.importBoard(dirPath)
  );

  // --- Configs ---

  ipcMain.handle("library:list", async () => store.listConfigs());

  ipcMain.handle("library:load", async (_event, name: string) =>
    store.loadConfig(name)
  );

  ipcMain.handle("library:save", async (_event, name: string, data: unknown) => {
    store.saveConfig(name, data);
    return { ok: true };
  });

  ipcMain.handle("library:delete", async (_event, name: string) => {
    store.deleteConfig(name);
    return { ok: true };
  });

  ipcMain.handle("library:import", async (_event, filePath: string) =>
    store.importConfig(filePath)
  );

  // --- Codegen ---

  ipcMain.handle(
    "codegen:validate",
    async (_event, manifestRaw: unknown, boardRaw: unknown) => {
      const manifest = ManifestSchema.parse(manifestRaw);
      const board = BoardDefSchema.parse(boardRaw);
      return validate(manifest, board);
    }
  );

  ipcMain.handle(
    "codegen:generate",
    async (_event, manifestRaw: unknown, boardRaw: unknown) => {
      const manifest = ManifestSchema.parse(manifestRaw);
      const board = BoardDefSchema.parse(boardRaw);
      const files = generateAll(manifest, board);

      const outputDir = store.getOutputDir();
      store.writeOutput(files, outputDir);

      return {
        outputDir,
        files: files.map((f) => ({
          path: f.relativePath,
          description: f.description,
          lines: f.content.split("\n").length,
        })),
      };
    }
  );

  // --- ESPHome ---

  ipcMain.handle("esphome:available", async () => ({
    installed: !!esphomePath,
    path: esphomePath,
  }));

  // Compile: spawns esphome compile, streams stdout/stderr to renderer via events
  ipcMain.handle(
    "esphome:compile",
    async (event, configName: string) => {
      if (!esphomePath) throw new Error("ESPHome not installed");

      const outputDir = store.getOutputDir();
      const dir = configName; // e.g. "pump-controller"
      const configPath = path.join(outputDir, "esphome", dir, `${dir}.yaml`);

      return runEsphome(event, ["compile", configPath]);
    }
  );

  // Flash: spawns esphome run, optionally with --device
  ipcMain.handle(
    "esphome:flash",
    async (event, configName: string, device?: string) => {
      if (!esphomePath) throw new Error("ESPHome not installed");

      const outputDir = store.getOutputDir();
      const dir = configName;
      const configPath = path.join(outputDir, "esphome", dir, `${dir}.yaml`);

      const args = ["run", configPath];
      if (device) args.push("--device", device);

      return runEsphome(event, args);
    }
  );

  // Logs: spawns esphome logs
  ipcMain.handle(
    "esphome:logs",
    async (event, configName: string, device?: string) => {
      if (!esphomePath) throw new Error("ESPHome not installed");

      const outputDir = store.getOutputDir();
      const dir = configName;
      const configPath = path.join(outputDir, "esphome", dir, `${dir}.yaml`);

      const args = ["logs", configPath];
      if (device) args.push("--device", device);

      return runEsphome(event, args);
    }
  );

  // --- Store info ---

  ipcMain.handle("store:path", async () => store.getStorePath());
  ipcMain.handle("store:output-dir", async () => store.getOutputDir());
}

// ---------------------------------------------------------------------------
// ESPHome process runner — streams output to renderer
// ---------------------------------------------------------------------------

function runEsphome(
  event: Electron.IpcMainInvokeEvent,
  args: string[]
): Promise<{ code: number | null; signal: string | null }> {
  return new Promise((resolve, reject) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win) return reject(new Error("No window"));

    const proc = spawn(esphomePath!, args, {
      stdio: ["ignore", "pipe", "pipe"],
    });

    proc.stdout.on("data", (chunk: Buffer) => {
      win.webContents.send("esphome:output", {
        stream: "stdout",
        text: chunk.toString("utf-8"),
      });
    });

    proc.stderr.on("data", (chunk: Buffer) => {
      win.webContents.send("esphome:output", {
        stream: "stderr",
        text: chunk.toString("utf-8"),
      });
    });

    proc.on("close", (code, signal) => {
      win.webContents.send("esphome:done", { code, signal });
      resolve({ code, signal });
    });

    proc.on("error", (err) => {
      reject(new Error(`Failed to start ESPHome: ${err.message}`));
    });
  });
}
