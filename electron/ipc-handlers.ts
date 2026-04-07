import { ipcMain, BrowserWindow, dialog, shell } from "electron";
import { BoardDefSchema } from "./lib/board.js";
import { TopologySchema } from "./lib/topology.js";
import { validateAll } from "./lib/validate.js";
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

/** Parse topology and derive manifest (activeGraph filtering happens inside topologyToManifest). */
function resolveTopologyAndManifest(dataRaw: unknown) {
  const topology = TopologySchema.parse(dataRaw);
  const manifest = topologyToManifest(topology);
  return { topology, manifest };
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
      store.saveConfig(name, data);
      return { ok: true };
    }
  );

  ipcMain.handle(
    "library:duplicate",
    async (_e, sourceName: string, newName: string) => {
      const savedName = store.duplicateConfig(sourceName, newName);
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
    "codegen:derive-routes",
    async (_e, dataRaw: unknown) => {
      const { manifest } = resolveTopologyAndManifest(dataRaw);
      return manifest.routes.map(r => ({ key: r.key, name: r.name }));
    }
  );

  ipcMain.handle(
    "codegen:validate",
    async (_e, dataRaw: unknown, boardRaw: unknown) => {
      const board = BoardDefSchema.parse(boardRaw);
      const { topology, manifest } = resolveTopologyAndManifest(dataRaw);
      return validateAll(topology, manifest, board);
    }
  );

  ipcMain.handle(
    "codegen:generate",
    async (_e, dataRaw: unknown, boardRaw: unknown, canvasSvg?: string) => {
      const board = BoardDefSchema.parse(boardRaw);
      const { topology, manifest } = resolveTopologyAndManifest(dataRaw);
      const validation = validateAll(topology, manifest, board);
      if (!validation.ok) {
        const errors = validation.diagnostics
          .filter(d => d.severity === 'error')
          .map(d => d.message);
        throw new Error(errors.join('\n'));
      }
      const files = generateAll(manifest, board, topology, canvasSvg);
      const outputDir = store.getOutputDir();
      store.writeOutput(files, outputDir);
      const deviceDir = manifest.device.directory ?? manifest.device.name;
      const docFile = files.find(f => f.relativePath.endsWith('documentation.html'));
      return {
        outputDir,
        deviceDir,
        files: files.map((f) => ({
          path: f.relativePath,
          description: f.description,
          lines: f.content.split("\n").length,
        })),
        documentationHtml: docFile?.content ?? null,
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

  // --- Shell ---

  ipcMain.handle("shell:open-path", async (_e, fullPath: string) =>
    shell.openPath(fullPath)
  );

  ipcMain.handle("shell:show-item-in-folder", async (_e, fullPath: string) => {
    shell.showItemInFolder(fullPath);
    return { ok: true };
  });

  // --- Store info ---

  ipcMain.handle("store:path", async () => store.getStorePath());
  ipcMain.handle("store:output-dir", async () => store.getOutputDir());
}
