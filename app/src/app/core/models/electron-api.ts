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
  board: unknown; // BoardDef — parsed by service
  svg: string | null;
}

export interface GenerateResult {
  path: string;
  description: string;
  lines: number;
}

export interface ValidationResult {
  errors: string[];
  warnings: string[];
  ok: boolean;
}

export interface ElectronAPI {
  libraryList(): Promise<LibraryEntry[]>;
  libraryLoad(name: string): Promise<unknown>;
  librarySave(name: string, data: unknown): Promise<{ ok: boolean }>;
  libraryDelete(name: string): Promise<{ ok: boolean }>;

  boardList(): Promise<BoardListEntry[]>;
  boardLoad(model: string): Promise<BoardLoadResult>;

  codegenValidate(manifest: unknown, board: unknown): Promise<ValidationResult>;
  codegenGenerate(manifest: unknown, board: unknown): Promise<GenerateResult[]>;

  flash(manifest: unknown, board: unknown, device?: string): Promise<void>;
}

declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}
