/** Type-safe interface for the Electron IPC bridge exposed via preload. */

export interface LibraryEntry {
  name: string;
  deviceName: string;
  friendlyName: string;
  board: string;
  tanks: number;
  valves: number;
  routes: number;
}

export interface BoardListEntry {
  id: string;
  model: string;
  label: string;
}

export interface BoardLoadResult {
  board: unknown;
  svg: string | null;
}

export interface GenerateResult {
  outputDir: string;
  files: Array<{
    path: string;
    description: string;
    lines: number;
  }>;
}

export interface ValidationResult {
  errors: string[];
  warnings: string[];
  ok: boolean;
}

export interface EsphomeStatus {
  installed: boolean;
  path: string | null;
}

export interface EsphomeResult {
  code: number | null;
  signal: string | null;
}

export interface ElectronAPI {
  libraryList(): Promise<LibraryEntry[]>;
  libraryLoad(name: string): Promise<unknown>;
  librarySave(name: string, data: unknown): Promise<{ ok: boolean }>;
  libraryDelete(name: string): Promise<{ ok: boolean }>;
  libraryImport(filePath: string): Promise<string>;

  boardList(): Promise<BoardListEntry[]>;
  boardLoad(model: string): Promise<BoardLoadResult>;
  boardImport(dirPath: string): Promise<string>;

  codegenValidate(manifest: unknown, board: unknown): Promise<ValidationResult>;
  codegenGenerate(manifest: unknown, board: unknown): Promise<GenerateResult>;

  esphomeAvailable(): Promise<EsphomeStatus>;
  esphomeCompile(configName: string): Promise<EsphomeResult>;
  esphomeFlash(configName: string, device?: string): Promise<EsphomeResult>;
  esphomeLogs(configName: string, device?: string): Promise<EsphomeResult>;
  onEsphomeOutput(callback: (data: { stream: string; text: string }) => void): () => void;
  onEsphomeDone(callback: (data: { code: number | null; signal: string | null }) => void): () => void;

  storePath(): Promise<string>;
  outputDir(): Promise<string>;
}

declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}
