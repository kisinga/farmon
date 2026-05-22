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
  codegenValidate: (manifest: unknown, board: unknown, siteId?: string) =>
    ipcRenderer.invoke("codegen:validate", manifest, board, siteId),
  codegenGenerate: (siteId: string, systemId: string, manifest: unknown, board: unknown) =>
    ipcRenderer.invoke("codegen:generate", siteId, systemId, manifest, board),
  codegenGenerateHA: (siteId: string) =>
    ipcRenderer.invoke("codegen:generate-ha", siteId),
  codegenGenerateSelfTest: (boardModel: string, secrets: Record<string, string>, network?: unknown) =>
    ipcRenderer.invoke("codegen:generate-selftest", boardModel, secrets, network),
  codegenGenerateSiteDocs: (siteId: string, compositeSvg: string, perSystemSvgs: Record<string, string>, systems: unknown[], links: unknown[], routes: unknown[]) =>
    ipcRenderer.invoke("codegen:generate-site-docs", siteId, compositeSvg, perSystemSvgs, systems, links, routes),
  codegenWriteScadaArtifacts: (siteId: string, artifacts: Array<{ name: string; svg: string; meta: unknown }>) =>
    ipcRenderer.invoke("codegen:write-scada-artifacts", siteId, artifacts),

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

  // --- Process events (main → renderer) ---
  onProcessStarted: (
    callback: (handle: {
      id: string;
      backend: string;
      operation: string;
      configName: string;
      pid: number | undefined;
    }) => void
  ) => {
    const listener = (_event: unknown, handle: Parameters<typeof callback>[0]) =>
      callback(handle);
    ipcRenderer.on("process:started", listener);
    return () => ipcRenderer.removeListener("process:started", listener);
  },
  onProcessOutput: (
    callback: (data: {
      id: string;
      backend: string;
      operation: string;
      stream: string;
      text: string;
    }) => void
  ) => {
    const listener = (_event: unknown, data: Parameters<typeof callback>[0]) =>
      callback(data);
    ipcRenderer.on("process:output", listener);
    return () => ipcRenderer.removeListener("process:output", listener);
  },
  onProcessDone: (
    callback: (data: {
      id: string;
      backend: string;
      operation: string;
      code: number | null;
      signal: string | null;
    }) => void
  ) => {
    const listener = (_event: unknown, data: Parameters<typeof callback>[0]) =>
      callback(data);
    ipcRenderer.on("process:done", listener);
    return () => ipcRenderer.removeListener("process:done", listener);
  },

  // --- Serial monitor ---
  serialMonitor: (port: string, baudRate: number) =>
    ipcRenderer.invoke("serial:monitor", port, baudRate),
  serialCancel: (processId: string) =>
    ipcRenderer.invoke("serial:cancel", processId),
  onSerialOutput: (
    callback: (data: {
      id: string;
      stream: string;
      text: string;
    }) => void
  ) => {
    const listener = (_event: unknown, data: Parameters<typeof callback>[0]) =>
      callback(data);
    ipcRenderer.on("serial:output", listener);
    return () => ipcRenderer.removeListener("serial:output", listener);
  },
  onSerialDone: (
    callback: (data: {
      id: string;
      code: number | null;
      signal: string | null;
    }) => void
  ) => {
    const listener = (_event: unknown, data: Parameters<typeof callback>[0]) =>
      callback(data);
    ipcRenderer.on("serial:done", listener);
    return () => ipcRenderer.removeListener("serial:done", listener);
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
  generationList: (siteId: string, systemId: string, genType?: string) =>
    ipcRenderer.invoke("generation:list", siteId, systemId, genType),
  generationLoad: (id: number) =>
    ipcRenderer.invoke("generation:load", id),
  generationFind: (version: string) =>
    ipcRenderer.invoke("generation:find", version),
  generationLatest: (siteId: string, systemId: string, genType?: string) =>
    ipcRenderer.invoke("generation:latest", siteId, systemId, genType),

  // --- System secrets ---
  secretsGet: (siteId: string, systemId: string) =>
    ipcRenderer.invoke("secrets:get", siteId, systemId),
  secretsSet: (siteId: string, systemId: string, secrets: Record<string, string>) =>
    ipcRenderer.invoke("secrets:set", siteId, systemId, secrets),

  // --- System settings ---
  settingsGet: (siteId: string, systemId: string, key: string) =>
    ipcRenderer.invoke("settings:get", siteId, systemId, key),
  settingsSet: (siteId: string, systemId: string, key: string, value: string) =>
    ipcRenderer.invoke("settings:set", siteId, systemId, key, value),
  settingsGetAll: (siteId: string, systemId: string) =>
    ipcRenderer.invoke("settings:get-all", siteId, systemId),
});
