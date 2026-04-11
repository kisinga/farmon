import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("electronAPI", {
  // Library CRUD
  libraryList: () => ipcRenderer.invoke("library:list"),
  libraryLoad: (name: string) => ipcRenderer.invoke("library:load", name),
  librarySave: (name: string, data: unknown) =>
    ipcRenderer.invoke("library:save", name, data),
  libraryDelete: (name: string) =>
    ipcRenderer.invoke("library:delete", name),
  libraryDuplicate: (sourceName: string, newName: string) =>
    ipcRenderer.invoke("library:duplicate", sourceName, newName),
  libraryImport: (filePath: string) =>
    ipcRenderer.invoke("library:import", filePath),
  libraryExport: (name: string, destPath: string) =>
    ipcRenderer.invoke("library:export", name, destPath),

  // Board definitions
  boardList: () => ipcRenderer.invoke("board:list"),
  boardLoad: (model: string) => ipcRenderer.invoke("board:load", model),
  boardImport: (dirPath: string) =>
    ipcRenderer.invoke("board:import", dirPath),

  // Codegen
  codegenDeriveRoutes: (topology: unknown) =>
    ipcRenderer.invoke("codegen:derive-routes", topology),
  codegenValidate: (manifest: unknown, board: unknown) =>
    ipcRenderer.invoke("codegen:validate", manifest, board),
  codegenGenerate: (manifest: unknown, board: unknown) =>
    ipcRenderer.invoke("codegen:generate", manifest, board),

  // Toolchain
  toolchainStatus: () => ipcRenderer.invoke("toolchain:status"),
  toolchainRefresh: () => ipcRenderer.invoke("toolchain:refresh"),

  // ESPHome operations
  esphomeCompile: (configName: string) =>
    ipcRenderer.invoke("esphome:compile", configName),
  esphomeFlash: (configName: string, device?: string) =>
    ipcRenderer.invoke("esphome:flash", configName, device),
  esphomeLogs: (configName: string, device?: string) =>
    ipcRenderer.invoke("esphome:logs", configName, device),
  esphomeCancel: (processId: string) =>
    ipcRenderer.invoke("esphome:cancel", processId),

  // ESPHome events (main → renderer)
  onEsphomeStarted: (
    callback: (handle: {
      id: string;
      operation: string;
      configName: string;
      pid: number | undefined;
    }) => void
  ) => {
    const listener = (_event: unknown, handle: Parameters<typeof callback>[0]) =>
      callback(handle);
    ipcRenderer.on("esphome:started", listener);
    return () => ipcRenderer.removeListener("esphome:started", listener);
  },
  onEsphomeOutput: (
    callback: (data: {
      id: string;
      operation: string;
      stream: string;
      text: string;
    }) => void
  ) => {
    const listener = (_event: unknown, data: Parameters<typeof callback>[0]) =>
      callback(data);
    ipcRenderer.on("esphome:output", listener);
    return () => ipcRenderer.removeListener("esphome:output", listener);
  },
  onEsphomeDone: (
    callback: (data: {
      id: string;
      operation: string;
      code: number | null;
      signal: string | null;
    }) => void
  ) => {
    const listener = (_event: unknown, data: Parameters<typeof callback>[0]) =>
      callback(data);
    ipcRenderer.on("esphome:done", listener);
    return () => ipcRenderer.removeListener("esphome:done", listener);
  },

  // Discovery
  deviceListSerial: () => ipcRenderer.invoke("device:list-serial"),

  // Health
  healthCheck: () => ipcRenderer.invoke("health:check"),
  healthFix: () => ipcRenderer.invoke("health:fix"),

  // File dialogs
  pickFile: (options: {
    title?: string;
    filters?: Array<{ name: string; extensions: string[] }>;
  }) => ipcRenderer.invoke("dialog:open-file", options),
  pickDirectory: (options: { title?: string }) =>
    ipcRenderer.invoke("dialog:open-directory", options),
  saveFile: (options: {
    title?: string;
    defaultPath?: string;
    filters?: Array<{ name: string; extensions: string[] }>;
  }) => ipcRenderer.invoke("dialog:save-file", options),

  // Shell
  shellOpenPath: (fullPath: string) =>
    ipcRenderer.invoke("shell:open-path", fullPath),
  shellShowInFolder: (fullPath: string) =>
    ipcRenderer.invoke("shell:show-item-in-folder", fullPath),

  // Store
  storePath: () => ipcRenderer.invoke("store:path"),
  outputDir: () => ipcRenderer.invoke("store:output-dir"),
  seedChanges: () => ipcRenderer.invoke("store:seed-changes"),
  applySeed: (id?: string) => ipcRenderer.invoke("store:apply-seed", id),
  dismissSeed: (id: string) => ipcRenderer.invoke("store:dismiss-seed", id),

  // Sites
  siteList: () => ipcRenderer.invoke("site:list"),
  siteLoad: (name: string) => ipcRenderer.invoke("site:load", name),
  siteSave: (name: string, data: unknown) =>
    ipcRenderer.invoke("site:save", name, data),
  siteDelete: (name: string) =>
    ipcRenderer.invoke("site:delete", name),
  siteDuplicate: (sourceName: string, newName: string) =>
    ipcRenderer.invoke("site:duplicate", sourceName, newName),
  siteConfigChecksum: (configName: string) =>
    ipcRenderer.invoke("site:config-checksum", configName),

  // HA config files
  siteHaList: (siteName: string) =>
    ipcRenderer.invoke("site:ha-list", siteName),
  siteHaLoad: (siteName: string, fileName: string) =>
    ipcRenderer.invoke("site:ha-load", siteName, fileName),
  siteHaSave: (siteName: string, fileName: string, content: string) =>
    ipcRenderer.invoke("site:ha-save", siteName, fileName, content),

  // Generation history
  generationList: (configName: string) =>
    ipcRenderer.invoke("generation:list", configName),
  generationLoad: (id: number) =>
    ipcRenderer.invoke("generation:load", id),
  generationFind: (version: string) =>
    ipcRenderer.invoke("generation:find", version),
  generationLatest: (configName: string) =>
    ipcRenderer.invoke("generation:latest", configName),
});
