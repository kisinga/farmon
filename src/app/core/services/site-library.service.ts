import { Injectable, signal } from '@angular/core';
import { ElectronService } from './electron.service';
import type { SiteListEntry } from '../models/electron-api';

@Injectable({ providedIn: 'root' })
export class SiteLibraryService {
  private _entries = signal<SiteListEntry[]>([]);
  private _loading = signal(false);

  readonly entries = this._entries.asReadonly();
  readonly loading = this._loading.asReadonly();

  constructor(private electron: ElectronService) {}

  async refresh(): Promise<void> {
    this._loading.set(true);
    try {
      this._entries.set(await this.electron.siteList());
    } finally {
      this._loading.set(false);
    }
  }

  async load(name: string): Promise<unknown> {
    return this.electron.siteLoad(name);
  }

  async save(name: string, data: unknown): Promise<void> {
    await this.electron.siteSave(name, data);
    await this.refresh();
  }

  async remove(name: string): Promise<void> {
    await this.electron.siteDelete(name);
    await this.refresh();
  }

  async duplicate(sourceName: string, newName: string): Promise<string> {
    const savedName = await this.electron.siteDuplicate(sourceName, newName);
    await this.refresh();
    return savedName;
  }
}
