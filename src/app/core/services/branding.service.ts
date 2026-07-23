import { Injectable, computed, signal, inject } from '@angular/core';
import { AuthStore } from './auth.store';
import { BackendService } from './backend.service';

export interface PartnerBranding {
  name?: string;
  slug?: string;
  logo_url?: string;
  brand_primary?: string;
  brand_accent?: string;
}

/**
 * Loads the authenticated user's partner-organization branding (logo + colors)
 * and applies it to the post-login shell. Fail-open: if the caller has no
 * partner org, or the fetch fails, the default MajiFlow branding remains.
 */
@Injectable({ providedIn: 'root' })
export class BrandingService {
  private readonly backend = inject(BackendService);
  private readonly auth = inject(AuthStore);

  private readonly branding = signal<PartnerBranding | null>(null);

  readonly name = computed(() => this.branding()?.name ?? '');
  readonly slug = computed(() => this.branding()?.slug ?? '');
  readonly logoUrl = computed(() => this.branding()?.logo_url ?? '');
  readonly primary = computed(() => this.branding()?.brand_primary ?? '');
  readonly accent = computed(() => this.branding()?.brand_accent ?? '');
  readonly hasBranding = computed(() => !!this.branding());

  constructor() {
    // React to login/logout. On first load a valid existing session triggers
    // a branding fetch; on logout the overrides are cleared.
    this.backend.pb.authStore.onChange((token) => {
      if (token) {
        void this.load();
      } else {
        this.clear();
      }
    });

    if (this.backend.pb.authStore.isValid) {
      void this.load();
    }
  }

  /** Re-fetch and re-apply the caller's org branding — called after the
   *  partner edits their org profile so their own shell updates immediately. */
  refresh(): Promise<void> {
    return this.load();
  }

  private async load(): Promise<void> {
    if (!this.auth.isAuthenticated()) {
      this.clear();
      return;
    }
    try {
      const data = (await this.backend.pb.send('/api/farmon/branding', {
        method: 'GET',
        signal: AbortSignal.timeout(5000),
      })) as PartnerBranding;
      this.branding.set(data);
      this.applyColors(data.brand_primary, data.brand_accent);
    } catch {
      // Fail-open: leave defaults.
      this.clear();
    }
  }

  private clear(): void {
    this.branding.set(null);
    this.applyColors(undefined, undefined);
  }

  private applyColors(primary?: string, accent?: string): void {
    const root = document.documentElement;
    if (primary) {
      root.style.setProperty('--color-brand-cyan', primary);
      root.style.setProperty('--color-primary', primary);
    } else {
      root.style.removeProperty('--color-brand-cyan');
      root.style.removeProperty('--color-primary');
    }
    if (accent) {
      root.style.setProperty('--color-brand-sky', accent);
      root.style.setProperty('--color-brand-deep', accent);
      root.style.setProperty('--color-secondary', accent);
    } else {
      root.style.removeProperty('--color-brand-sky');
      root.style.removeProperty('--color-brand-deep');
      root.style.removeProperty('--color-secondary');
    }
  }
}
