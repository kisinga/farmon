import { Injectable, signal, computed } from '@angular/core';
import { ElectronService } from './electron.service';
import type { LibraryEntry } from '../models/electron-api';

@Injectable({ providedIn: 'root' })
export class LibraryService {
  private _entries = signal<LibraryEntry[]>([]);
  private _loading = signal(false);

  readonly entries = this._entries.asReadonly();
  readonly loading = this._loading.asReadonly();

  /** Bundled templates — read-only, re-seeded on startup. */
  readonly templates = computed(() => this._entries().filter(e => e.library));

  /** User-created configs — fully editable. */
  readonly userConfigs = computed(() => this._entries().filter(e => !e.library));

  constructor(private electron: ElectronService) {}

  async refresh(): Promise<void> {
    this._loading.set(true);
    try {
      this._entries.set(await this.electron.libraryList());
    } finally {
      this._loading.set(false);
    }
  }

  async load(name: string): Promise<unknown> {
    return this.electron.libraryLoad(name);
  }

  /** Save a user config in place. Throws if name is a template. */
  async save(name: string, data: unknown): Promise<void> {
    await this.electron.librarySave(name, data);
    await this.refresh();
  }

  /** Duplicate any config (template or user) to a new user config. Returns the saved name. */
  async duplicate(sourceName: string, newName: string): Promise<string> {
    const savedName = await this.electron.libraryDuplicate(sourceName, newName);
    await this.refresh();
    return savedName;
  }

  /** Delete a user config. Throws if name is a template. */
  async remove(name: string): Promise<void> {
    await this.electron.libraryDelete(name);
    await this.refresh();
  }
}
