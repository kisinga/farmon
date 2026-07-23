import { Injectable } from '@angular/core';
import { DashboardLayoutService } from '../widgets/layout.service';
import type { LayoutItem } from '../widgets/layout';

/**
 * DeviceLayoutService — the device-mode dashboard layout store. The device has
 * no PocketBase (`dashboard_layouts` collection), so the layout persists to
 * localStorage only: the same `maji.dashlayout.{siteId}` cache key the cloud
 * service uses as its write-through cache. The per-user vs site-default
 * distinction collapses to a single slot — one operator, one layout.
 *
 * Registered in device.providers.ts (the provider-swap idiom); tree-shakes out
 * of the cloud build.
 */
@Injectable()
export class DeviceLayoutService extends DashboardLayoutService {
  /** The cached layout, or null (the shell falls back to the auto-derived one). */
  override load(siteId: string): Promise<LayoutItem[] | null> {
    return Promise.resolve(this.cached(siteId));
  }

  /** Persist the draft to the single local slot (scope is meaningless here). */
  override save(siteId: string, items: LayoutItem[], _scope: 'user' | 'site'): Promise<void> {
    this.writeCache(siteId, items);
    return Promise.resolve();
  }

  /** Forget the saved layout — the next load resolves the auto-derived one. */
  override reset(siteId: string): Promise<void> {
    this.clearCache(siteId);
    return Promise.resolve();
  }
}
