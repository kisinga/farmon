/** Type-safe interface for the Electron IPC bridge exposed via preload. */

import type { ValidationResult, RuleDiagnostic } from '@far-mon/core';
import type {
  SiteListEntry, SiteFullPayload, SiteSavePayload,
  LinkData, SystemPayload, TemplateListEntry,
} from '@far-mon/core';

export type { ValidationResult, RuleDiagnostic };
export type { SiteListEntry, SiteFullPayload, SiteSavePayload, LinkData, SystemPayload, TemplateListEntry };

// --- Boards ---

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

// --- Generation ---

export type GenerationType = 'esphome' | 'ha';

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
}

export interface GenerateHAResult {
  outputDir: string;
  files: Array<{
    path: string;
    description: string;
    lines: number;
  }>;
}

export interface GenerationMeta {
  id: number;
  version: string;
  siteId: string;
  systemId: string;
  genType: GenerationType;
  schemaVersion: number;
  fileCount: number;
  createdAt: string;
}

export interface GenerationSnapshot extends GenerationMeta {
  topology: string;
  board: string;
}

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

// --- Serial monitor ---

export interface SerialHandle {
  id: string;
  port: string;
  baudRate: number;
  pid: number | undefined;
}

export interface SerialOutputEvent {
  id: string;
  stream: "stdout" | "stderr";
  text: string;
}

export interface SerialDoneEvent {
  id: string;
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
  kind: "board";
  id: string;
  label: string;
  action: "added" | "updated";
}

// --- ElectronAPI ---

export interface ElectronAPI {
  // Sites
  siteList(): Promise<SiteListEntry[]>;
  siteLoad(id: string): Promise<SiteFullPayload>;
  siteSave(payload: SiteSavePayload): Promise<{ ok: boolean }>;
  siteCreate(id: string, friendlyName: string): Promise<{ ok: boolean }>;
  siteDelete(id: string): Promise<{ ok: boolean }>;
  siteDuplicate(sourceId: string, newId: string, newFriendlyName: string): Promise<{ ok: boolean; id: string }>;
  siteRename(id: string, friendlyName: string): Promise<{ ok: boolean }>;
  siteExport(siteId: string): Promise<{ ok: boolean; path?: string }>;
  siteImport(): Promise<{ ok: boolean; siteId?: string }>;

  // Systems
  systemList(siteId: string): Promise<Array<{ id: string; friendlyName: string; board: string; nodeCount: number }>>;
  systemAddFromTemplate(siteId: string, templateName: string): Promise<SystemPayload>;
  systemDelete(siteId: string, systemId: string): Promise<{ ok: boolean }>;

  // Templates
  templateList(): Promise<TemplateListEntry[]>;
  templateLoad(name: string): Promise<unknown>;

  // Boards
  boardList(): Promise<BoardListEntry[]>;
  boardLoad(model: string): Promise<BoardLoadResult>;
  boardImport(dirPath: string): Promise<string>;

  // Codegen
  codegenDeriveRoutes(topology: unknown): Promise<Array<{ key: string; name: string }>>;
  codegenValidate(manifest: unknown, board: unknown): Promise<ValidationResult>;
  codegenGenerate(siteId: string, systemId: string, manifest: unknown, board: unknown): Promise<GenerateResult>;
  codegenGenerateHA(siteId: string): Promise<GenerateHAResult>;
  codegenGenerateSelfTest(boardModel: string, secrets: Record<string, string>): Promise<{ outputDir: string; deviceDir: string; files: Array<{ path: string; description: string; lines: number }> }>;
  codegenGenerateSiteDocs(siteId: string, compositeSvg: string, perSystemSvgs: Record<string, string>, systems: unknown[], links: unknown[], routes: unknown[]): Promise<{ html: string; outputPath: string }>;

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

  // Serial monitor
  serialMonitor(port: string, baudRate: number): Promise<ProcessResult>;
  serialCancel(processId: string): Promise<{ cancelled: boolean }>;
  onSerialStarted(callback: (handle: SerialHandle) => void): () => void;
  onSerialOutput(callback: (data: SerialOutputEvent) => void): () => void;
  onSerialDone(callback: (data: SerialDoneEvent) => void): () => void;

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

  // HA config files
  siteHaList(siteId: string): Promise<string[]>;
  siteHaLoad(siteId: string, filename: string): Promise<string>;
  siteHaSave(siteId: string, filename: string, content: string): Promise<{ ok: boolean }>;

  // Legacy import
  legacyHasData(): Promise<boolean>;
  legacyScan(): Promise<{ sites: Array<{ id: string; friendlyName: string; systems: unknown[]; links: unknown[]; haFiles: unknown[] }> }>;
  legacyImport(sites: unknown): Promise<{ imported: number }>;

  // Generation history
  generationList(siteId: string, systemId: string, genType?: GenerationType): Promise<GenerationMeta[]>;
  generationLoad(id: number): Promise<GenerationSnapshot | null>;
  generationFind(version: string): Promise<GenerationSnapshot | null>;
  generationLatest(siteId: string, systemId: string, genType?: GenerationType): Promise<GenerationMeta | null>;

  // System secrets
  secretsGet(siteId: string, systemId: string): Promise<Record<string, string>>;
  secretsSet(siteId: string, systemId: string, secrets: Record<string, string>): Promise<void>;
}

declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}
