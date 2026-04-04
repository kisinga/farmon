import { Injectable } from '@angular/core';
import type {
  ElectronAPI,
  LibraryEntry,
  BoardListEntry,
  BoardLoadResult,
  GenerateResult,
  ValidationResult,
  EsphomeStatus,
  EsphomeResult,
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
    if (!this.api) return Promise.resolve({ errors: ['Not in Electron'], warnings: [], ok: false });
    return this.api.codegenValidate(manifest, board);
  }
  generate(manifest: unknown, board: unknown): Promise<GenerateResult> {
    return this.invoke(() => this.api!.codegenGenerate(manifest, board));
  }

  // --- ESPHome ---
  esphomeAvailable(): Promise<EsphomeStatus> {
    if (!this.api) return Promise.resolve({ installed: false, path: null });
    return this.api.esphomeAvailable();
  }
  esphomeCompile(configName: string): Promise<EsphomeResult> {
    return this.invoke(() => this.api!.esphomeCompile(configName));
  }
  esphomeFlash(configName: string, device?: string): Promise<EsphomeResult> {
    return this.invoke(() => this.api!.esphomeFlash(configName, device));
  }
  esphomeLogs(configName: string, device?: string): Promise<EsphomeResult> {
    return this.invoke(() => this.api!.esphomeLogs(configName, device));
  }

  /** Subscribe to ESPHome stdout/stderr stream. Returns unsubscribe fn. */
  onEsphomeOutput(callback: (data: { stream: string; text: string }) => void): () => void {
    return this.api?.onEsphomeOutput(callback) ?? (() => {});
  }
  onEsphomeDone(callback: (data: { code: number | null; signal: string | null }) => void): () => void {
    return this.api?.onEsphomeDone(callback) ?? (() => {});
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
