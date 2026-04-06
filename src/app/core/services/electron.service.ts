import { Injectable } from '@angular/core';
import type {
  ElectronAPI,
  LibraryEntry,
  BoardListEntry,
  BoardLoadResult,
  GenerateResult,
  ValidationResult,
  ToolchainInfo,
  ProcessResult,
  ProcessHandle,
  ProcessOutputEvent,
  ProcessDoneEvent,
  SerialDevice,
  HealthReport,
} from '../models/electron-api';

@Injectable({ providedIn: 'root' })
export class ElectronService {
  private get api(): ElectronAPI | undefined {
    return (window as Window).electronAPI;
  }

  get isElectron(): boolean {
    return !!this.api;
  }

  // --- Library ---
  libraryList(): Promise<LibraryEntry[]> {
    return this.api?.libraryList() ?? Promise.resolve([]);
  }
  libraryLoad(name: string): Promise<unknown> {
    return this.invoke(() => this.api!.libraryLoad(name));
  }
  async librarySave(name: string, data: unknown): Promise<void> {
    await this.invoke(() => this.api!.librarySave(name, data));
  }
  async libraryDuplicate(sourceName: string, newName: string): Promise<string> {
    const result = await this.invoke(() => this.api!.libraryDuplicate(sourceName, newName));
    return result.name;
  }
  async libraryDelete(name: string): Promise<void> {
    await this.invoke(() => this.api!.libraryDelete(name));
  }

  // --- Boards ---
  boardList(): Promise<BoardListEntry[]> {
    return this.api?.boardList() ?? Promise.resolve([]);
  }
  boardLoad(model: string): Promise<BoardLoadResult> {
    return this.invoke(() => this.api!.boardLoad(model));
  }

  // --- Codegen ---
  validate(manifest: unknown, board: unknown): Promise<ValidationResult> {
    if (!this.api) return Promise.resolve({ errors: ['Not in Electron'], warnings: [], ok: false, diagnostics: [] });
    return this.api.codegenValidate(manifest, board);
  }
  generate(manifest: unknown, board: unknown): Promise<GenerateResult> {
    return this.invoke(() => this.api!.codegenGenerate(manifest, board));
  }

  // --- Toolchain ---
  toolchainStatus(): Promise<ToolchainInfo> {
    if (!this.api) return Promise.resolve({ esphomePath: null, pythonPath: null, version: null });
    return this.api.toolchainStatus();
  }
  toolchainRefresh(): Promise<ToolchainInfo> {
    return this.invoke(() => this.api!.toolchainRefresh());
  }

  // --- ESPHome operations ---
  esphomeCompile(configName: string): Promise<ProcessResult> {
    return this.invoke(() => this.api!.esphomeCompile(configName));
  }
  esphomeFlash(configName: string, device?: string): Promise<ProcessResult> {
    return this.invoke(() => this.api!.esphomeFlash(configName, device));
  }
  esphomeLogs(configName: string, device?: string): Promise<ProcessResult> {
    return this.invoke(() => this.api!.esphomeLogs(configName, device));
  }
  esphomeCancel(processId: string): Promise<{ cancelled: boolean }> {
    return this.invoke(() => this.api!.esphomeCancel(processId));
  }

  // --- ESPHome events ---
  onEsphomeStarted(callback: (handle: ProcessHandle) => void): () => void {
    return this.api?.onEsphomeStarted(callback) ?? (() => {});
  }
  onEsphomeOutput(callback: (data: ProcessOutputEvent) => void): () => void {
    return this.api?.onEsphomeOutput(callback) ?? (() => {});
  }
  onEsphomeDone(callback: (data: ProcessDoneEvent) => void): () => void {
    return this.api?.onEsphomeDone(callback) ?? (() => {});
  }

  // --- Discovery ---
  deviceListSerial(): Promise<SerialDevice[]> {
    if (!this.api) return Promise.resolve([]);
    return this.api.deviceListSerial();
  }

  // --- Import / Export ---
  importConfig(filePath: string): Promise<string> {
    return this.invoke(() => this.api!.libraryImport(filePath));
  }
  importBoard(dirPath: string): Promise<string> {
    return this.invoke(() => this.api!.boardImport(dirPath));
  }
  exportConfig(name: string, destPath: string): Promise<{ ok: boolean }> {
    return this.invoke(() => this.api!.libraryExport(name, destPath));
  }

  // --- File Dialogs ---
  pickFile(options: { title?: string; filters?: Array<{ name: string; extensions: string[] }> } = {}): Promise<string | null> {
    if (!this.api) return Promise.resolve(null);
    return this.api.pickFile(options);
  }
  pickDirectory(options: { title?: string } = {}): Promise<string | null> {
    if (!this.api) return Promise.resolve(null);
    return this.api.pickDirectory(options);
  }
  saveFile(options: { title?: string; defaultPath?: string; filters?: Array<{ name: string; extensions: string[] }> } = {}): Promise<string | null> {
    if (!this.api) return Promise.resolve(null);
    return this.api.saveFile(options);
  }

  // --- Health ---
  healthCheck(): Promise<HealthReport> {
    if (!this.api) return Promise.resolve({ ok: false, checks: [] });
    return this.api.healthCheck();
  }
  healthFix(): Promise<{ success: boolean; output: string }> {
    return this.invoke(() => this.api!.healthFix());
  }

  // --- Store ---
  outputDir(): Promise<string> {
    return this.invoke(() => this.api!.outputDir());
  }

  private invoke<T>(fn: () => Promise<T>): Promise<T> {
    if (!this.api) return Promise.reject(new Error('Not running in Electron'));
    return fn();
  }
}
