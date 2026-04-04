import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("electronAPI", {
  // Library CRUD
  libraryList: () => ipcRenderer.invoke("library:list"),
  libraryLoad: (name: string) => ipcRenderer.invoke("library:load", name),
  librarySave: (name: string, data: unknown) =>
    ipcRenderer.invoke("library:save", name, data),
  libraryDelete: (name: string) =>
    ipcRenderer.invoke("library:delete", name),
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

  // Store
  storePath: () => ipcRenderer.invoke("store:path"),
  outputDir: () => ipcRenderer.invoke("store:output-dir"),
});
