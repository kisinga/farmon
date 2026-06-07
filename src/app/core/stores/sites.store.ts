import { Injectable, inject } from '@angular/core';
import { BackendService } from '../services/backend.service';
import type { SiteListEntry } from '../models/backend-api';
import { Cached } from './collection-store';

/**
 * SitesStore — the shared site catalog. Home, Overview and Devices all read the
 * site list; this caches one fetch and shares it (the in-flight dedup is what
 * stops their `controllers`/`sites` scans from auto-cancelling each other).
 *
 * Mutations keep the cached list honest: rename/delete patch it in place (the
 * open Overview updates with no refetch); create/import invalidate it (callers
 * navigate into the new site, so the next list read refetches with its derived
 * counts). The editor invalidates after a save (topology counts changed).
 */
@Injectable({ providedIn: 'root' })
export class SitesStore {
  private backend = inject(BackendService);

  private _list = new Cached<SiteListEntry[]>(() => this.backend.siteList(), []);
  readonly list = this._list.value;
  readonly loading = this._list.loading;
  readonly error = this._list.error;

  ensureLoaded(force = false): Promise<SiteListEntry[]> {
    return this._list.ensureLoaded(force);
  }
  reload(): Promise<SiteListEntry[]> {
    return this._list.reload();
  }
  /** Drop the cached list (counts/topology changed elsewhere → refetch next read). */
  invalidate(): void {
    this._list.invalidate();
  }

  // --- Mutations: keep the cached list honest ----------------------------

  async create(slug: string, friendlyName: string): Promise<{ id: string }> {
    const r = await this.backend.siteCreate(slug, friendlyName);
    this._list.invalidate();
    return r;
  }

  async import(text: string): Promise<{ id: string }> {
    const r = await this.backend.siteImport(text);
    this._list.invalidate();
    return r;
  }

  async rename(id: string, friendlyName: string): Promise<void> {
    await this.backend.siteRename(id, friendlyName);
    this._list.update((list) => list.map((s) => (s.id === id ? { ...s, friendlyName } : s)));
  }

  async delete(id: string): Promise<void> {
    await this.backend.siteDelete(id);
    this._list.update((list) => list.filter((s) => s.id !== id));
  }
}
