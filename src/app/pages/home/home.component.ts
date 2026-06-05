import { Component, inject, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { BackendService } from '../../core/services/backend.service';
import { AuthStore } from '../../core/services/auth.store';
import type { SiteListEntry } from '../../core/models/backend-api';

/**
 * Post-login landing + role-aware redirect target. Admins go to the sites
 * admin (/overview). Customers go to their site dashboard — straight there if
 * they own exactly one, otherwise a small picker. Also the fallback the
 * roleGuard sends unauthorized users to, so a customer hitting an admin route
 * lands somewhere they belong instead of looping on /overview.
 */
@Component({
  selector: 'app-home',
  standalone: true,
  imports: [RouterLink],
  host: { class: 'flex-1 overflow-auto' },
  template: `
    <div class="max-w-3xl mx-auto w-full px-6 py-10">
      @if (loading()) {
        <div class="flex items-center justify-center py-24"><span class="loading loading-spinner loading-lg"></span></div>
      } @else if (error()) {
        <div class="alert alert-error text-sm">{{ error() }}</div>
      } @else if (sites()?.length === 0) {
        <div class="text-center py-16">
          <h1 class="text-lg font-semibold">No sites yet</h1>
          <p class="text-sm text-base-content/50 mt-1">No sites are assigned to your account. Contact your installer.</p>
        </div>
      } @else {
        <h1 class="text-xl font-bold tracking-tight mb-4">Your sites</h1>
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
          @for (s of sites() ?? []; track s.id) {
            <a [routerLink]="['/site', s.id, 'dashboard']"
               class="bg-base-100 rounded-xl border border-base-300/40 hover:border-primary/40 px-5 py-4 transition-colors">
              <div class="font-semibold text-sm">{{ s.friendlyName }}</div>
              <div class="text-xs text-base-content/50 mt-0.5">{{ s.controllerCount }} controllers · {{ s.nodeCount }} nodes</div>
            </a>
          }
        </div>
      }
    </div>
  `,
})
export class HomeComponent {
  private auth = inject(AuthStore);
  private backend = inject(BackendService);
  private router = inject(Router);

  protected loading = signal(true);
  protected error = signal<string | null>(null);
  protected sites = signal<SiteListEntry[] | null>(null);

  constructor() {
    if (this.auth.isAdmin()) {
      void this.router.navigate(['/overview']);
      return;
    }
    void this.load();
  }

  private async load(): Promise<void> {
    try {
      const sites = await this.backend.siteList();
      if (sites.length === 1) {
        void this.router.navigate(['/site', sites[0].id, 'dashboard']);
        return;
      }
      this.sites.set(sites);
    } catch (err) {
      this.error.set(String(err));
    } finally {
      this.loading.set(false);
    }
  }
}
