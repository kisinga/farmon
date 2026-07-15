import { Injectable, computed, inject } from '@angular/core';
import type { RecordModel } from 'pocketbase';
import { BackendService } from '../services/backend.service';
import type { SiteCatalogItem, SiteListEntry } from '../models/backend-api';
import type { StoredSiteTopology } from '@core';
import type { SiteAlertConfig } from '../models/alerts';
import { resolveOfflineMs } from '../models/alerts';
import { getNumber, getString, getStringArray } from '../util/record';
import { CollectionStore } from './collection-store';

/** Map the rich server catalog item to the display shape the cards expect.
 *  The fields are a superset, so this is just a cast-like copy. */
function toListEntry(item: SiteCatalogItem): SiteListEntry {
  return { ...item };
}

function toAlertConfig(item: SiteCatalogItem): SiteAlertConfig {
  const low = Number(item.tankLowPct);
  const high = Number(item.tankHighPct);
  return {
    name: item.friendlyName,
    lowPct: Number.isFinite(low) && low > 0 ? low : 20,
    highPct: Number.isFinite(high) && high > 0 ? high : null,
    offlineMs: resolveOfflineMs(item.offlineTimeoutS),
  };
}

function toCatalogItem(r: RecordModel): SiteCatalogItem {
  return {
    id: getString(r, 'id'),
    friendlyName: getString(r, 'name'),
    owners: getStringArray(r, 'owner'),
    controllerCount: getNumber(r, 'controller_count'),
    nodeCount: getNumber(r, 'node_count'),
    mode: getString(r, 'mode'),
    deviceCount: getNumber(r, 'device_count'),
    liveCount: getNumber(r, 'live_count'),
    commenceDate: getString(r, 'commence_date'),
    tankLowPct: getNumber(r, 'tank_low_pct'),
    tankHighPct: getNumber(r, 'tank_high_pct'),
    offlineTimeoutS: getNumber(r, 'offline_timeout_s'),
  };
}

function patchItemFromRecord(item: SiteCatalogItem, r: RecordModel): SiteCatalogItem {
  return {
    ...toCatalogItem(r),
    // Preserve existing values if the realtime record didn't carry them
    // (some update events only include changed fields).
    friendlyName: getString(r, 'name', item.friendlyName),
    tankLowPct: getNumber(r, 'tank_low_pct', item.tankLowPct),
    tankHighPct: getNumber(r, 'tank_high_pct', item.tankHighPct),
    offlineTimeoutS: getNumber(r, 'offline_timeout_s', item.offlineTimeoutS),
    owners: getStringArray(r, 'owner').length > 0 ? getStringArray(r, 'owner') : item.owners,
  };
}

/**
 * SitesStore — the single source of truth for the site catalog.
 *
 * It owns the server-backed catalog (display fields + alert thresholds) and
 * exposes both the card-list projection and the per-site alert config. Other
 * stores (AlertsStore) read from here instead of fetching sites again.
 */
@Injectable({ providedIn: 'root' })
export class SitesStore extends CollectionStore<SiteCatalogItem[]> {
  private backend = inject(BackendService);
  /** Site list projection (shape the UI cards expect). */
  readonly list = computed<SiteListEntry[]>(() => this.value().map(toListEntry));
  /** Alert thresholds by site id. */
  readonly configs = computed(() => {
    const map = new Map<string, SiteAlertConfig>();
    for (const item of this.value()) map.set(item.id, toAlertConfig(item));
    return map;
  });

  constructor() {
    super([]);
  }
  protected async fetch(): Promise<SiteCatalogItem[]> {
    const records = await this.backend.siteList();
    return records.map(toCatalogItem);
  }

  /** Alert configuration for a site, derived from the shared catalog. */
  siteConfig(siteId: string): SiteAlertConfig | undefined {
    return this.configs().get(siteId);
  }

  /** Update a single entry from a realtime record (name/thresholds/owners/counts). */
  patchSite(record: RecordModel): void {
    const id = getString(record, 'id');
    this.mutate((list) => list.map((s) => (s.id === id ? patchItemFromRecord(s, record) : s)));
  }

  // --- Mutations: keep the cached list honest ----------------------------

  async create(slug: string, friendlyName: string, topology?: StoredSiteTopology): Promise<{ id: string }> {
    const r = await this.backend.siteCreate(slug, friendlyName, topology);
    await this.reload();
    return r;
  }

  async import(text: string): Promise<{ id: string }> {
    const r = await this.backend.siteImport(text);
    await this.reload();
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
      const current = this.value().find((s) => s.id === siteId)?.owners ?? [];
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
