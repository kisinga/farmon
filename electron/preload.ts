import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("electronAPI", {
  // --- Sites ---
  siteList: () => ipcRenderer.invoke("site:list"),
  siteLoad: (id: string) => ipcRenderer.invoke("site:load", id),
  siteSave: (payload: unknown) => ipcRenderer.invoke("site:save", payload),
  siteCreate: (id: string, friendlyName: string) =>
    ipcRenderer.invoke("site:create", id, friendlyName),
  siteDelete: (id: string) => ipcRenderer.invoke("site:delete", id),
  siteDuplicate: (sourceId: string, newId: string, newFriendlyName: string) =>
    ipcRenderer.invoke("site:duplicate", sourceId, newId, newFriendlyName),
  siteRename: (id: string, friendlyName: string) =>
    ipcRenderer.invoke("site:rename", id, friendlyName),
  siteExport: (siteId: string) =>
    ipcRenderer.invoke("site:export", siteId),
  siteImport: () =>
    ipcRenderer.invoke("site:import"),

  // --- Systems ---
  systemList: (siteId: string) => ipcRenderer.invoke("system:list", siteId),
  systemAddFromTemplate: (siteId: string, templateName: string) =>
    ipcRenderer.invoke("system:add-from-template", siteId, templateName),
  systemDelete: (siteId: string, systemId: string) =>
    ipcRenderer.invoke("system:delete", siteId, systemId),

  // --- Templates ---
  templateList: () => ipcRenderer.invoke("template:list"),
  templateLoad: (name: string) => ipcRenderer.invoke("template:load", name),

  // --- Board definitions ---
  boardList: () => ipcRenderer.invoke("board:list"),
  boardLoad: (model: string) => ipcRenderer.invoke("board:load", model),
  boardImport: (dirPath: string) => ipcRenderer.invoke("board:import", dirPath),

  // --- Codegen ---
  codegenDeriveRoutes: (topology: unknown) =>
    ipcRenderer.invoke("codegen:derive-routes", topology),
  codegenValidate: (manifest: unknown, board: unknown) =>
    ipcRenderer.invoke("codegen:validate", manifest, board),
  codegenGenerate: (siteId: string, systemId: string, manifest: unknown, board: unknown) =>
    ipcRenderer.invoke("codegen:generate", siteId, systemId, manifest, board),
  codegenGenerateSiteDocs: (siteId: string, compositeSvg: string, systems: unknown[], links: unknown[], routes: unknown[]) =>
    ipcRenderer.invoke("codegen:generate-site-docs", siteId, compositeSvg, systems, links, routes),

  // --- Toolchain ---
  toolchainStatus: () => ipcRenderer.invoke("toolchain:status"),
  toolchainRefresh: () => ipcRenderer.invoke("toolchain:refresh"),

  // --- ESPHome operations ---
  esphomeCompile: (configName: string) =>
    ipcRenderer.invoke("esphome:compile", configName),
  esphomeFlash: (configName: string, device?: string) =>
    ipcRenderer.invoke("esphome:flash", configName, device),
  esphomeLogs: (configName: string, device?: string) =>
    ipcRenderer.invoke("esphome:logs", configName, device),
  esphomeCancel: (processId: string) =>
    ipcRenderer.invoke("esphome:cancel", processId),

  // --- ESPHome events (main → renderer) ---
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

  // --- Discovery ---
  deviceListSerial: () => ipcRenderer.invoke("device:list-serial"),

  // --- Health ---
  healthCheck: () => ipcRenderer.invoke("health:check"),
  healthFix: () => ipcRenderer.invoke("health:fix"),

  // --- File dialogs ---
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

  // --- Shell ---
  shellOpenPath: (fullPath: string) =>
    ipcRenderer.invoke("shell:open-path", fullPath),
  shellShowInFolder: (fullPath: string) =>
    ipcRenderer.invoke("shell:show-item-in-folder", fullPath),

  // --- Store ---
  storePath: () => ipcRenderer.invoke("store:path"),
  outputDir: () => ipcRenderer.invoke("store:output-dir"),
  seedChanges: () => ipcRenderer.invoke("store:seed-changes"),
  applySeed: (id?: string) => ipcRenderer.invoke("store:apply-seed", id),
  dismissSeed: (id: string) => ipcRenderer.invoke("store:dismiss-seed", id),

  // --- HA config files ---
  siteHaList: (siteId: string) =>
    ipcRenderer.invoke("site:ha-list", siteId),
  siteHaLoad: (siteId: string, filename: string) =>
    ipcRenderer.invoke("site:ha-load", siteId, filename),
  siteHaSave: (siteId: string, filename: string, content: string) =>
    ipcRenderer.invoke("site:ha-save", siteId, filename, content),

  // --- Legacy import ---
  legacyHasData: () => ipcRenderer.invoke("legacy:has-data"),
  legacyScan: () => ipcRenderer.invoke("legacy:scan"),
  legacyImport: (sites: unknown) => ipcRenderer.invoke("legacy:import", sites),

  // --- Generation history ---
  generationList: (siteId: string, systemId: string) =>
    ipcRenderer.invoke("generation:list", siteId, systemId),
  generationLoad: (id: number) =>
    ipcRenderer.invoke("generation:load", id),
  generationFind: (version: string) =>
    ipcRenderer.invoke("generation:find", version),
  generationLatest: (siteId: string, systemId: string) =>
    ipcRenderer.invoke("generation:latest", siteId, systemId),
});
