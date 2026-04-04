import { ipcMain } from "electron";
import { ManifestSchema } from "./lib/schema.js";
import { validate } from "./lib/validate.js";
import { generateAll } from "./lib/generate.js";
import { BoardDefSchema } from "./lib/board.js";
import * as store from "./store.js";

export function registerIpcHandlers() {
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

      // Write to default output dir alongside the store
      const outputDir = store.getStorePath().replace(/store$/, "output");
      store.writeOutput(files, outputDir);

      return files.map((f) => ({
        path: f.relativePath,
        description: f.description,
        lines: f.content.split("\n").length,
      }));
    }
  );

  // --- Store info ---

  ipcMain.handle("store:path", async () => store.getStorePath());
}
