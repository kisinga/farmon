import { Injectable, Signal, WritableSignal, inject, signal } from '@angular/core';
import { BackendService } from '../core/services/backend.service';
import { DEVICE_MODE } from '../core/tokens/device-mode';

/**
 * Tri-state capability cache: still fetching, fetch failed (treated as an
 * empty set — entitled widgets hide, nothing crashes), or the granted keys.
 */
export type CapabilitiesState = 'loading' | 'unavailable' | string[];

interface SiteCapabilities {
  capabilities?: string[];
  widget_ids?: string[];
}

/** Cooldown before an 'unavailable' (fetch-failed) state may re-enter: one
 *  transient error must not latch the site's entitled widgets hidden forever. */
const RETRY_AFTER_MS = 30_000;

/**
 * CapabilitiesService — per-site cache of the site's entitlement set, fetched
 * from the custom endpoint (`GET /api/farmon/sites/{id}/capabilities`). The
 * dashboard shell filters the widget registry by it; hiding is a convenience —
 * the backend already enforces the underlying capabilities on its own routes.
 *
 * Root-provided; one in-flight fetch per site, shared by every caller. A
 * failed fetch latches 'unavailable' only for {@link RETRY_AFTER_MS} — a
 * transient error must not hide entitled widgets for the whole session.
 */
@Injectable({ providedIn: 'root' })
export class CapabilitiesService {
  private backend = inject(BackendService);
  private deviceMode = inject(DEVICE_MODE);
  private states = new Map<string, WritableSignal<CapabilitiesState>>();
  private inFlight = new Set<string>();
  /** When each site's fetch last failed — drives the retry cooldown. */
  private failedAt = new Map<string, number>();

  /** The site's capability state, fetching on first call for a site, and
   *  RE-fetching an 'unavailable' state once the retry cooldown has elapsed. */
  capabilities(siteId: string): Signal<CapabilitiesState> {
    let s = this.states.get(siteId);
    if (!s) {
      // Device build: no PocketBase, no capabilities endpoint — the set is
      // empty (cloud-only widgets are already filtered out at build level).
      s = signal<CapabilitiesState>(this.deviceMode ? [] : 'loading');
      this.states.set(siteId, s);
      if (!this.deviceMode) void this.fetch(siteId, s);
    } else if (
      s() === 'unavailable' &&
      !this.inFlight.has(siteId) &&
      Date.now() - (this.failedAt.get(siteId) ?? 0) >= RETRY_AFTER_MS
    ) {
      s.set('loading');
      void this.fetch(siteId, s);
    }
    return s.asReadonly();
  }

  private async fetch(siteId: string, s: WritableSignal<CapabilitiesState>): Promise<void> {
    if (this.inFlight.has(siteId)) return;
    this.inFlight.add(siteId);
    try {
      const r = await this.backend.pb.send<SiteCapabilities>(
        `/api/farmon/sites/${encodeURIComponent(siteId)}/capabilities`,
        { method: 'GET', requestKey: `capabilities:${siteId}` },
      );
      s.set(Array.isArray(r.capabilities) ? r.capabilities : []);
    } catch {
      // Any error (offline, 404, 403) → unavailable, which the shell treats as
      // an empty set: entitled widgets hide, the rest render unaffected. The
      // next capabilities() call after the cooldown refetches.
      this.failedAt.set(siteId, Date.now());
      s.set('unavailable');
    } finally {
      this.inFlight.delete(siteId);
    }
  }
}
