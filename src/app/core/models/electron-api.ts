/** Type-safe interface for the Electron IPC bridge exposed via preload. */

export interface LibraryEntry {
  name: string;
  deviceName: string;
  friendlyName: string;
  board: string;
  tanks: number;
  valves: number;
  routes: number;
  library: boolean;
}

export interface BoardListEntry {
  id: string;
  model: string;
  label: string;
  library: boolean;
}

export interface BoardLoadResult {
  board: unknown;
  svg: string | null;
}

export interface GenerateResult {
  outputDir: string;
  deviceDir: string;
  generationId: number;
  version: string;
  files: Array<{
    path: string;
    description: string;
    lines: number;
  }>;
  documentationHtml: string | null;
}

export interface GenerationMeta {
  id: number;
  version: string;
  configName: string;
  schemaVersion: number;
  fileCount: number;
  createdAt: string;
}

export interface GenerationSnapshot extends GenerationMeta {
  topology: string;
  board: string;
}

import type { ValidationResult, RuleDiagnostic } from '@far-mon/core';
export type { ValidationResult, RuleDiagnostic };

// --- Toolchain ---

export interface ToolchainInfo {
  esphomePath: string | null;
  pythonPath: string | null;
  version: string | null;
}

// --- Process lifecycle ---

export type ProcessOperation = "compile" | "flash" | "logs";

export interface ProcessHandle {
  id: string;
  operation: ProcessOperation;
  configName: string;
  pid: number | undefined;
}

export interface ProcessResult {
  id: string;
  code: number | null;
  signal: string | null;
}

export interface ProcessOutputEvent {
  id: string;
  operation: ProcessOperation;
  stream: "stdout" | "stderr";
  text: string;
}

export interface ProcessDoneEvent {
  id: string;
  operation: ProcessOperation;
  code: number | null;
  signal: string | null;
}

// --- Discovery ---

export interface SerialDevice {
  port: string;
  description: string;
  hwid: string;
}

// --- Health ---

export interface HealthReport {
  ok: boolean;
  checks: HealthCheck[];
}

export interface HealthCheck {
  name: string;
  status: 'ok' | 'missing' | 'error';
  detail: string;
  fixable: boolean;
}

// --- Seed changes ---

export interface SeedChange {
  kind: "board" | "config";
  id: string;
  label: string;
  action: "added" | "updated";
}

// --- ElectronAPI ---

export interface ElectronAPI {
  // Library
  libraryList(): Promise<LibraryEntry[]>;
  libraryLoad(name: string): Promise<unknown>;
  librarySave(name: string, data: unknown): Promise<{ ok: boolean }>;
  libraryDelete(name: string): Promise<{ ok: boolean }>;
  libraryDuplicate(sourceName: string, newName: string): Promise<{ ok: boolean; name: string }>;
  libraryImport(filePath: string): Promise<string>;
  libraryExport(name: string, destPath: string): Promise<{ ok: boolean }>;

  // Boards
  boardList(): Promise<BoardListEntry[]>;
  boardLoad(model: string): Promise<BoardLoadResult>;
  boardImport(dirPath: string): Promise<string>;

  // Codegen
  codegenDeriveRoutes(topology: unknown): Promise<Array<{ key: string; name: string }>>;
  codegenValidate(manifest: unknown, board: unknown): Promise<ValidationResult>;
  codegenGenerate(manifest: unknown, board: unknown): Promise<GenerateResult>;

  // Toolchain
  toolchainStatus(): Promise<ToolchainInfo>;
  toolchainRefresh(): Promise<ToolchainInfo>;

  // ESPHome operations
  esphomeCompile(configName: string): Promise<ProcessResult>;
  esphomeFlash(configName: string, device?: string): Promise<ProcessResult>;
  esphomeLogs(configName: string, device?: string): Promise<ProcessResult>;
  esphomeCancel(processId: string): Promise<{ cancelled: boolean }>;

  // ESPHome events
  onEsphomeStarted(callback: (handle: ProcessHandle) => void): () => void;
  onEsphomeOutput(callback: (data: ProcessOutputEvent) => void): () => void;
  onEsphomeDone(callback: (data: ProcessDoneEvent) => void): () => void;

  // Discovery
  deviceListSerial(): Promise<SerialDevice[]>;

  // Health
  healthCheck(): Promise<HealthReport>;
  healthFix(): Promise<{ success: boolean; output: string }>;

  // File dialogs
  pickFile(options: { title?: string; filters?: Array<{ name: string; extensions: string[] }> }): Promise<string | null>;
  pickDirectory(options: { title?: string }): Promise<string | null>;
  saveFile(options: { title?: string; defaultPath?: string; filters?: Array<{ name: string; extensions: string[] }> }): Promise<string | null>;

  // Shell
  shellOpenPath(fullPath: string): Promise<string>;
  shellShowInFolder(fullPath: string): Promise<{ ok: boolean }>;

  // Store
  storePath(): Promise<string>;
  outputDir(): Promise<string>;
  seedChanges(): Promise<SeedChange[]>;
  applySeed(id?: string): Promise<{ ok: boolean }>;
  dismissSeed(id: string): Promise<{ ok: boolean }>;

  // Generation history
  generationList(configName: string): Promise<GenerationMeta[]>;
  generationLoad(id: number): Promise<GenerationSnapshot | null>;
  generationFind(version: string): Promise<GenerationSnapshot | null>;
  generationLatest(configName: string): Promise<GenerationMeta | null>;
}

declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}
