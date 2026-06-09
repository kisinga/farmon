import { Injectable, inject } from '@angular/core';
import { BackendService } from '../services/backend.service';
import type { SiteListEntry } from '../models/backend-api';
import { CollectionStore } from './collection-store';

/**
 * SitesStore — the shared site catalog. Home, Overview and Devices all read the
 * site list; the base Cached shares one fetch (its in-flight dedup is what stops
 * their `controllers`/`sites` scans from auto-cancelling each other).
 *
 * Mutations keep the cached list honest: rename/assign/delete patch it in place
 * (the open Overview updates with no refetch); create/import invalidate it
 * (callers navigate into the new site, so the next read refetches with its
 * derived counts). The editor invalidates after a save (topology counts changed).
 */
@Injectable({ providedIn: 'root' })
export class SitesStore extends CollectionStore<SiteListEntry[]> {
  private backend = inject(BackendService);
  /** The cached site catalog (alias of the base `value`). */
  readonly list = this.value;

  constructor() {
    super([]);
  }
  protected fetch(): Promise<SiteListEntry[]> {
    return this.backend.siteList();
  }

  // --- Mutations: keep the cached list honest ----------------------------

  async create(slug: string, friendlyName: string): Promise<{ id: string }> {
    const r = await this.backend.siteCreate(slug, friendlyName);
    this.invalidate();
    return r;
  }

  async import(text: string): Promise<{ id: string }> {
    const r = await this.backend.siteImport(text);
    this.invalidate();
    return r;
  }

  async rename(id: string, friendlyName: string): Promise<void> {
    await this.backend.siteRename(id, friendlyName);
    this.mutate((list) => list.map((s) => (s.id === id ? { ...s, friendlyName } : s)));
  }

  /** Reassign a site to a customer (admin-only). Patches the cached owner. */
  async assignOwner(id: string, owner: string): Promise<void> {
    await this.backend.siteAssignOwner(id, owner);
    this.mutate((list) => list.map((s) => (s.id === id ? { ...s, owner } : s)));
  }

  async delete(id: string): Promise<void> {
    await this.backend.siteDelete(id);
    this.mutate((list) => list.filter((s) => s.id !== id));
  }
}
