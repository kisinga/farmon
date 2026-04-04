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

  // ESPHome
  esphomeAvailable: () => ipcRenderer.invoke("esphome:available"),
  esphomeCompile: (configName: string) =>
    ipcRenderer.invoke("esphome:compile", configName),
  esphomeFlash: (configName: string, device?: string) =>
    ipcRenderer.invoke("esphome:flash", configName, device),
  esphomeLogs: (configName: string, device?: string) =>
    ipcRenderer.invoke("esphome:logs", configName, device),

  // ESPHome output stream (main → renderer events)
  onEsphomeOutput: (callback: (data: { stream: string; text: string }) => void) => {
    const listener = (_event: unknown, data: { stream: string; text: string }) => callback(data);
    ipcRenderer.on("esphome:output", listener);
    return () => ipcRenderer.removeListener("esphome:output", listener);
  },
  onEsphomeDone: (callback: (data: { code: number | null; signal: string | null }) => void) => {
    const listener = (_event: unknown, data: { code: number | null; signal: string | null }) => callback(data);
    ipcRenderer.on("esphome:done", listener);
    return () => ipcRenderer.removeListener("esphome:done", listener);
  },

  // Store
  storePath: () => ipcRenderer.invoke("store:path"),
  outputDir: () => ipcRenderer.invoke("store:output-dir"),
});
