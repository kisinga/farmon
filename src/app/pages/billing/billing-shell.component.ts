import { Component, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { BackendService } from '../../core/services/backend.service';
import { AuthStore } from '../../core/services/auth.store';
import { BillingService } from './billing.service';

/**
 * BillingShellComponent (`/site/:name/billing`) — page chrome for the tenant
 * billing section: back link, title, the sub-nav (same btn + routerLinkActive
 * idiom as the app top bar) and the capability gate. Child pages render inside
 * the outlet and inject this shell for the site id.
 *
 * Gating is two-layer (per the billing spec): the `billing_module` feature flag
 * guards the routes; the per-site `tenant_billing` capability is probed here on
 * load — off shows an empty state (the backend enforces it too; this is
 * convenience so owners see a clear message instead of API errors).
 */
@Component({
  selector: 'app-billing-shell',
  standalone: true,
  imports: [RouterLink, RouterLinkActive, RouterOutlet],
  host: { class: 'flex-1 overflow-auto' },
  template: `
    <div class="max-w-6xl mx-auto w-full px-4 sm:px-6 py-5 sm:py-6 flex flex-col gap-5">
      <header class="min-w-0">
        <a [routerLink]="['/site', siteId(), 'dashboard']" class="text-xs text-base-content/50 hover:text-base-content/80 transition-colors">← Dashboard</a>
        <h1 class="app-title text-xl font-semibold mt-0.5">Billing</h1>
        <p class="text-sm text-base-content/50 mt-0.5">Tenant water billing{{ siteName() ? ' for ' + siteName() : '' }} — meters, accounts, invoices and payments.</p>
      </header>

      @if (capability() === null) {
        <div class="flex items-center justify-center py-24"><span class="loading loading-spinner loading-lg"></span></div>
      } @else if (capability() === false) {
        <div class="rounded-2xl border border-dashed border-base-300/50 py-16 text-center">
          <p class="text-base font-medium">Tenant billing is not enabled for this site</p>
          <p class="text-sm text-base-content/50 mt-1">Contact your provider to enable the billing module on this site.</p>
        </div>
      } @else {
        <nav class="flex flex-wrap gap-1" aria-label="Billing sections">
          <a [routerLink]="['/site', siteId(), 'billing']" [routerLinkActiveOptions]="{ exact: true }" routerLinkActive="btn-active" class="btn btn-ghost btn-sm">Overview</a>
          <a [routerLink]="['/site', siteId(), 'billing', 'meters']" routerLinkActive="btn-active" class="btn btn-ghost btn-sm">Meters</a>
          <a [routerLink]="['/site', siteId(), 'billing', 'tenants']" routerLinkActive="btn-active" class="btn btn-ghost btn-sm">Tenants &amp; units</a>
          <a [routerLink]="['/site', siteId(), 'billing', 'invoices']" routerLinkActive="btn-active" class="btn btn-ghost btn-sm">Invoices</a>
          <a [routerLink]="['/site', siteId(), 'billing', 'settings']" routerLinkActive="btn-active" class="btn btn-ghost btn-sm">Settings</a>
        </nav>
        <router-outlet />
      }
    </div>
  `,
})
export class BillingShellComponent {
  private route = inject(ActivatedRoute);
  private backend = inject(BackendService);
  private billing = inject(BillingService);
  private auth = inject(AuthStore);

  readonly siteId = signal(this.route.snapshot.paramMap.get('name') ?? '');
  readonly siteName = signal('');
  /** null = probing; true/false once the capability endpoint answered. */
  readonly capability = signal<boolean | null>(null);

  /** Delete rules on the billing master-data collections are admin-only. */
  readonly isAdmin = computed(() => this.auth.isAdmin());

  constructor() {
    const id = this.siteId();
    if (id) void this.load(id);
  }

  private async load(siteId: string): Promise<void> {
    try {
      const { site } = await this.backend.siteLoad(siteId);
      this.siteName.set(site.friendlyName);
    } catch { /* name is cosmetic */ }
    try {
      this.capability.set(await this.billing.capability(siteId));
    } catch {
      // A failed probe (network/403) reads the same as "not enabled": the
      // backend would refuse every billing call anyway.
      this.capability.set(false);
    }
  }
}
