import { app, BrowserWindow } from "electron";
import * as path from "node:path";
import { registerIpcHandlers } from "./ipc-handlers.js";
import { initStore } from "./store.js";
import { killAll } from "./process-manager.js";

let mainWindow: BrowserWindow | null = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1024,
    minHeight: 700,
    title: "waterctl",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  const isDev = !app.isPackaged;
  if (isDev) {
    mainWindow.loadURL("http://localhost:4200");
    mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadFile(
      path.join(__dirname, "..", "dist", "app", "browser", "index.html")
    );
  }

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

app.whenReady().then(() => {
  // Init store: copy bundled defaults on first run
  // In dev: defaults/ is alongside electron/ in the source tree
  // In production: defaults/ is bundled with the app
  const isDev = !app.isPackaged;
  const defaultsDir = isDev
    ? path.join(__dirname, "..", "defaults")
    : path.join(process.resourcesPath, "defaults");

  initStore(defaultsDir);
  registerIpcHandlers();
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("before-quit", () => {
  killAll();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
