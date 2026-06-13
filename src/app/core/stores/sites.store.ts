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

  /** Replace a site's co-owner set (admin-only). Patches the cached list. */
  async setOwners(id: string, owners: string[]): Promise<void> {
    await this.backend.siteSetOwners(id, owners);
    this.mutate((list) => list.map((s) => (s.id === id ? { ...s, owners } : s)));
  }

  /** Per-site serialization for toggleOwner — see below. */
  private ownerOps = new Map<string, Promise<void>>();

  /** Add or remove one user from a site's co-owner set, computed from the cached
   *  list. A no-op if already in the desired state. Used by both assignment
   *  directions (a site's user picker and a customer's site picker).
   *
   *  Toggles on the same site are serialized: each `owner` PATCH replaces the
   *  whole set, so two overlapping toggles would both read the same pre-mutation
   *  cache and the second would clobber the first (a lost co-owner). Chaining per
   *  site means each toggle reads the cache the previous one already patched. */
  toggleOwner(siteId: string, userId: string, assigned: boolean): Promise<void> {
    const prior = this.ownerOps.get(siteId) ?? Promise.resolve();
    const next = prior.catch(() => {}).then(async () => {
      const current = this.list().find((s) => s.id === siteId)?.owners ?? [];
      if (current.includes(userId) === assigned) return; // already in desired state
      const updated = assigned ? [...current, userId] : current.filter((id) => id !== userId);
      await this.setOwners(siteId, updated);
    });
    this.ownerOps.set(siteId, next);
    return next.finally(() => {
      if (this.ownerOps.get(siteId) === next) this.ownerOps.delete(siteId);
    });
  }

  async delete(id: string): Promise<void> {
    await this.backend.siteDelete(id);
    this.mutate((list) => list.filter((s) => s.id !== id));
  }
}
