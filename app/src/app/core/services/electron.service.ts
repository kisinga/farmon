import { Injectable } from '@angular/core';
import type {
  ElectronAPI,
  LibraryEntry,
  BoardListEntry,
  BoardLoadResult,
  GenerateResult,
  ValidationResult,
} from '../models/electron-api';

/**
 * Type-safe wrapper around the Electron IPC bridge.
 * Falls back to mock data when running in browser (ng serve without Electron).
 */
@Injectable({ providedIn: 'root' })
export class ElectronService {
  private get api(): ElectronAPI | undefined {
    return (window as Window).electronAPI;
  }

  get isElectron(): boolean {
    return !!this.api;
  }

  async libraryList(): Promise<LibraryEntry[]> {
    if (!this.api) return [];
    return this.api.libraryList();
  }

  async libraryLoad(name: string): Promise<unknown> {
    if (!this.api) throw new Error('Not running in Electron');
    return this.api.libraryLoad(name);
  }

  async librarySave(name: string, data: unknown): Promise<void> {
    if (!this.api) throw new Error('Not running in Electron');
    await this.api.librarySave(name, data);
  }

  async libraryDelete(name: string): Promise<void> {
    if (!this.api) throw new Error('Not running in Electron');
    await this.api.libraryDelete(name);
  }

  async boardList(): Promise<BoardListEntry[]> {
    if (!this.api) return [];
    return this.api.boardList();
  }

  async boardLoad(model: string): Promise<BoardLoadResult> {
    if (!this.api) throw new Error('Not running in Electron');
    return this.api.boardLoad(model);
  }

  async validate(manifest: unknown, board: unknown): Promise<ValidationResult> {
    if (!this.api) return { errors: ['Not running in Electron'], warnings: [], ok: false };
    return this.api.codegenValidate(manifest, board);
  }

  async generate(manifest: unknown, board: unknown): Promise<GenerateResult[]> {
    if (!this.api) throw new Error('Not running in Electron');
    return this.api.codegenGenerate(manifest, board);
  }
}
