import { ipcMain, BrowserWindow, dialog } from "electron";
import { BoardDefSchema } from "./lib/board.js";
import { TopologySchema } from "./lib/topology.js";
import { validate } from "./lib/validate.js";
import { generateAll } from "./lib/generate.js";
import { topologyToManifest } from "./lib/topology-to-manifest.js";
import * as store from "./store.js";
import { detectToolchain, refreshToolchain } from "./toolchain.js";
import { checkHealth, fixDeps } from "./health.js";
import * as esphome from "./esphome.js";
import { killProcess } from "./process-manager.js";
import { listSerialPorts } from "./discovery.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function winFromEvent(event: Electron.IpcMainInvokeEvent): BrowserWindow {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (!win) throw new Error("No window");
  return win;
}

/** Parse topology and derive the flat manifest for codegen/validation. */
function resolveManifest(dataRaw: unknown): import("./lib/schema.js").Manifest {
  const topology = TopologySchema.parse(dataRaw);
  return topologyToManifest(topology);
}

// ---------------------------------------------------------------------------
// IPC handlers
// ---------------------------------------------------------------------------

export function registerIpcHandlers() {
  // --- Boards ---

  ipcMain.handle("board:list", async () => store.listBoards());

  ipcMain.handle("board:load", async (_e, model: string) =>
    store.loadBoard(model)
  );

  ipcMain.handle("board:import", async (_e, dirPath: string) =>
    store.importBoard(dirPath)
  );

  // --- Configs ---

  ipcMain.handle("library:list", async () => store.listConfigs());

  ipcMain.handle("library:load", async (_e, name: string) =>
    store.loadConfig(name)
  );

  ipcMain.handle(
    "library:save",
    async (_e, name: string, data: unknown) => {
      const savedName = store.saveConfig(name, data);
      return { ok: true, name: savedName };
    }
  );

  ipcMain.handle("library:delete", async (_e, name: string) => {
    store.deleteConfig(name);
    return { ok: true };
  });

  ipcMain.handle("library:import", async (_e, filePath: string) =>
    store.importConfig(filePath)
  );

  ipcMain.handle(
    "library:export",
    async (_e, name: string, destPath: string) => {
      store.exportConfig(name, destPath);
      return { ok: true };
    }
  );

  // --- Codegen ---

  // --- Codegen (accepts topology or manifest) ---

  ipcMain.handle(
    "codegen:validate",
    async (_e, dataRaw: unknown, boardRaw: unknown) => {
      const board = BoardDefSchema.parse(boardRaw);
      const manifest = resolveManifest(dataRaw);
      return validate(manifest, board);
    }
  );

  ipcMain.handle(
    "codegen:generate",
    async (_e, dataRaw: unknown, boardRaw: unknown) => {
      const board = BoardDefSchema.parse(boardRaw);
      const manifest = resolveManifest(dataRaw);
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

  // --- Toolchain ---

  ipcMain.handle("toolchain:status", async () => detectToolchain());
  ipcMain.handle("toolchain:refresh", async () => refreshToolchain());

  // --- ESPHome operations ---

  ipcMain.handle("esphome:compile", async (event, configName: string) => {
    const { result } = esphome.compile(winFromEvent(event), configName);
    return result;
  });

  ipcMain.handle(
    "esphome:flash",
    async (event, configName: string, device?: string) => {
      const { result } = esphome.flash(
        winFromEvent(event),
        configName,
        device
      );
      return result;
    }
  );

  ipcMain.handle(
    "esphome:logs",
    async (event, configName: string, device?: string) => {
      const { result } = esphome.logs(
        winFromEvent(event),
        configName,
        device
      );
      return result;
    }
  );

  ipcMain.handle("esphome:cancel", async (_e, processId: string) => ({
    cancelled: killProcess(processId),
  }));

  // --- Discovery ---

  ipcMain.handle("device:list-serial", async () => listSerialPorts());

  // --- Health ---

  ipcMain.handle("health:check", async () => checkHealth());
  ipcMain.handle("health:fix", async () => fixDeps());

  // --- File dialogs ---

  ipcMain.handle(
    "dialog:open-file",
    async (
      event,
      options: {
        title?: string;
        filters?: Array<{ name: string; extensions: string[] }>;
      }
    ) => {
      const win = winFromEvent(event);
      const result = await dialog.showOpenDialog(win, {
        title: options.title,
        filters: options.filters,
        properties: ["openFile"],
      });
      return result.canceled ? null : result.filePaths[0];
    }
  );

  ipcMain.handle(
    "dialog:open-directory",
    async (event, options: { title?: string }) => {
      const win = winFromEvent(event);
      const result = await dialog.showOpenDialog(win, {
        title: options.title,
        properties: ["openDirectory"],
      });
      return result.canceled ? null : result.filePaths[0];
    }
  );

  ipcMain.handle(
    "dialog:save-file",
    async (
      event,
      options: {
        title?: string;
        defaultPath?: string;
        filters?: Array<{ name: string; extensions: string[] }>;
      }
    ) => {
      const win = winFromEvent(event);
      const result = await dialog.showSaveDialog(win, {
        title: options.title,
        defaultPath: options.defaultPath,
        filters: options.filters,
      });
      return result.canceled ? null : result.filePath;
    }
  );

  // --- Store info ---

  ipcMain.handle("store:path", async () => store.getStorePath());
  ipcMain.handle("store:output-dir", async () => store.getOutputDir());
}
