import { Injectable, inject } from '@angular/core';
import { BackendService } from '../core/services/backend.service';
import { AuthStore } from '../core/services/auth.store';
import { parseLayout, pickEffectiveLayout, serializeLayout, type LayoutItem } from './layout';

/** The layout profile the site dashboard saves/loads under. */
const LAYOUT_KEY = 'site-dashboard';

/**
 * DashboardLayoutService — the stored layout for a site dashboard
 * (`dashboard_layouts` collection, keyed `(key='site-dashboard', site, user)`;
 * an empty `user` is the shared site default, a set user a personal override —
 * the personal row wins).
 *
 * A localStorage write-through cache (`maji.dashlayout.{siteId}`) gives instant
 * paint on revisit; every read is validated by `parseLayout`, so corruption
 * anywhere falls back to the auto-derived default layout.
 *
 * The device build swaps this for `DeviceLayoutService` (device.providers.ts),
 * which keeps only the localStorage cache — the PB row methods below are the
 * overridable surface.
 */
@Injectable({ providedIn: 'root' })
export class DashboardLayoutService {
  private backend = inject(BackendService);
  private auth = inject(AuthStore);
  private get pb() {
    return this.backend.pb;
  }

  protected cacheKey(siteId: string): string {
    return `maji.dashlayout.${siteId}`;
  }

  /** The cached layout for instant paint, or null. SSR-guarded; corrupt cache
   *  entries parse to null (caller falls back to the derived layout). */
  cached(siteId: string): LayoutItem[] | null {
    if (typeof window === 'undefined') return null;
    try {
      const raw = localStorage.getItem(this.cacheKey(siteId));
      return raw ? parseLayout(JSON.parse(raw)) : null;
    } catch {
      return null;
    }
  }

  /**
   * Fetch the user's and the site-default rows and pick the effective layout
   * (personal override first, then the shared default). A SUCCESSFUL fetch is
   * authoritative: a parseable row writes through to the localStorage cache;
   * NO parseable row clears the cache and returns null — a layout deleted via
   * Reset on another device must not resurrect from a stale local copy. Only a
   * fetch FAILURE falls back to the cache, then null (auto-derived layout).
   */
  async load(siteId: string): Promise<LayoutItem[] | null> {
    try {
      const uid = this.auth.user()?.id ?? '';
      const rows = await this.pb.collection('dashboard_layouts').getFullList({
        filter: this.pb.filter('key = {:k} && site = {:s} && (user = "" || user = {:u})', {
          k: LAYOUT_KEY,
          s: siteId,
          u: uid,
        }),
        requestKey: `dashlayout:${siteId}:${uid}`,
      });
      const items = pickEffectiveLayout(
        rows.map((r) => ({ user: r['user'] as string, layout: r['layout'] })),
        uid,
      );
      if (items) {
        this.writeCache(siteId, items);
        return items;
      }
      this.clearCache(siteId);
      return null;
    } catch {
      return this.cached(siteId);
    }
  }

  /**
   * Upsert a layout. `scope: 'user'` writes the caller's personal override
   * (any authed viewer with site access); `scope: 'site'` writes the shared
   * site default (collection rules restrict that to site owners — the shell
   * only offers it to owners). The create → unique-index race (another tab or
   * the site default landing between the check and the create) is handled by
   * re-fetching the row and updating it. Writes through to the cache.
   */
  async save(siteId: string, items: LayoutItem[], scope: 'user' | 'site'): Promise<void> {
    const uid = this.auth.user()?.id ?? '';
    if (scope === 'user' && !uid) throw new Error('Not signed in.');
    const user = scope === 'site' ? '' : uid;
    const layout = JSON.parse(serializeLayout(items)) as unknown;
    const existing = await this.findRow(siteId, user);
    if (existing) {
      await this.pb.collection('dashboard_layouts').update(existing, { layout });
    } else {
      try {
        await this.pb.collection('dashboard_layouts').create({ key: LAYOUT_KEY, site: siteId, user, layout });
      } catch {
        // Unique (key, site, user): a concurrent create beat us — update instead.
        const raced = await this.findRow(siteId, user);
        if (!raced) throw new Error('Could not save the dashboard layout.');
        await this.pb.collection('dashboard_layouts').update(raced, { layout });
      }
    }
    this.writeCache(siteId, items);
  }

  /**
   * Reset to the auto-derived layout: delete the caller's personal row, plus
   * the shared site default when the caller owns the site (non-owners can't
   * delete it anyway — collection rules). Clears the cache so the next load
   * can't resurrect a stale layout.
   */
  async reset(siteId: string, includeSiteDefault: boolean): Promise<void> {
    const uid = this.auth.user()?.id ?? '';
    const targets = uid ? [uid, ...(includeSiteDefault ? [''] : [])] : [];
    for (const user of targets) {
      const id = await this.findRow(siteId, user);
      if (id) await this.pb.collection('dashboard_layouts').delete(id);
    }
    this.clearCache(siteId);
  }

  /** The id of the (key, site, user) row, or null when none exists (404). */
  private async findRow(siteId: string, user: string): Promise<string | null> {
    try {
      const row = await this.pb.collection('dashboard_layouts').getFirstListItem(
        this.pb.filter('key = {:k} && site = {:s} && user = {:u}', { k: LAYOUT_KEY, s: siteId, u: user }),
      );
      return row.id;
    } catch {
      return null;
    }
  }

  protected writeCache(siteId: string, items: LayoutItem[]): void {
    if (typeof window === 'undefined') return;
    try {
      localStorage.setItem(this.cacheKey(siteId), serializeLayout(items));
    } catch {
      /* private mode */
    }
  }

  protected clearCache(siteId: string): void {
    if (typeof window === 'undefined') return;
    try {
      localStorage.removeItem(this.cacheKey(siteId));
    } catch {
      /* private mode */
    }
  }
}
