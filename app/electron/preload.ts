import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("electronAPI", {
  // Library CRUD
  libraryList: () => ipcRenderer.invoke("library:list"),
  libraryLoad: (name: string) => ipcRenderer.invoke("library:load", name),
  librarySave: (name: string, data: unknown) =>
    ipcRenderer.invoke("library:save", name, data),
  libraryDelete: (name: string) =>
    ipcRenderer.invoke("library:delete", name),

  // Board definitions
  boardList: () => ipcRenderer.invoke("board:list"),
  boardLoad: (model: string) => ipcRenderer.invoke("board:load", model),

  // Codegen
  codegenValidate: (manifest: unknown, board: unknown) =>
    ipcRenderer.invoke("codegen:validate", manifest, board),
  codegenGenerate: (manifest: unknown, board: unknown) =>
    ipcRenderer.invoke("codegen:generate", manifest, board),

  // Flash
  flash: (manifest: unknown, board: unknown, device?: string) =>
    ipcRenderer.invoke("codegen:flash", manifest, board, device),
});
