import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { CustomersStore } from '../../core/stores/customers.store';
import { SitesStore } from '../../core/stores/sites.store';
import { BrandingService } from '../../core/services/branding.service';
import { PartnerService, type IncidentEntry } from './partner.service';
import { SectionHeaderComponent } from '../editor/shared/section-header.component';
import type { SiteCatalogItem } from '../../core/models/backend-api';

const KIND_LABELS: Record<string, string> = {
  device_offline: 'Controller offline',
  fault: 'Fault',
  tank_low: 'Tank low',
  tank_high: 'Tank high',
};

function fmtDate(iso: string): string {
  const d = new Date(iso);
  return iso && !isNaN(d.getTime()) ? d.toLocaleString() : '—';
}

function ago(iso: string): string {
  const ts = Date.parse(iso);
  if (!Number.isFinite(ts)) return '';
  const s = Math.max(0, Math.round((Date.now() - ts) / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

/**
 * Partner home (/partner) — the org-wide aggregate a partner lands on: fleet
 * stats, a per-site table (customer, live/offline, active alerts, last
 * activity) and the recent incidents feed. Everything is scoped by the
 * existing collection rules (sites.partner, notification_incidents via
 * migration 62); the page adds no backend of its own.
 */
@Component({
  selector: 'app-partner-home',
  standalone: true,
  imports: [RouterLink, SectionHeaderComponent],
  host: { class: 'flex-1 overflow-auto' },
  template: `
    <div class="content-pane space-y-6">
      <div class="flex items-start justify-between gap-4 flex-wrap">
        <app-section-header
          [title]="branding.name() ? branding.name() + ' — Partner home' : 'Partner home'"
          subtitle="Your whole fleet at a glance. Open a site for its live dashboard." />
        <a routerLink="/partner/customers/new"
           class="btn btn-sm rounded-full border-0 bg-cyan-400 text-slate-950 hover:bg-cyan-300 gap-1.5 shadow-lg shadow-cyan-500/20 shrink-0">
          <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5">
            <path stroke-linecap="round" stroke-linejoin="round" d="M12 4v16m8-8H4" />
          </svg>
          New customer
        </a>
      </div>

      @if (loading()) {
        <div class="flex items-center justify-center py-24"><span class="loading loading-spinner loading-lg text-cyan-400"></span></div>
      } @else {
        <!-- Fleet stats -->
        <div class="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <div class="surface p-4">
            <div class="text-2xl font-semibold tabular-nums">{{ customers().length }}</div>
            <div class="mt-1 text-[11px] uppercase tracking-wide text-base-content/40">Customers</div>
          </div>
          <div class="surface p-4">
            <div class="text-2xl font-semibold tabular-nums">{{ sites().length }}</div>
            <div class="mt-1 text-[11px] uppercase tracking-wide text-base-content/40">Sites</div>
          </div>
          <div class="surface p-4">
            <div class="text-2xl font-semibold tabular-nums">
              <span [class]="offlineControllers() > 0 ? 'text-amber-400' : ''">{{ liveControllers() }}</span>
              <span class="text-base-content/40 text-lg"> / {{ totalControllers() }}</span>
            </div>
            <div class="mt-1 text-[11px] uppercase tracking-wide text-base-content/40">Controllers live</div>
          </div>
          <div class="surface p-4">
            <div class="text-2xl font-semibold tabular-nums" [class]="activeAlerts() > 0 ? 'text-error' : ''">{{ activeAlerts() }}</div>
            <div class="mt-1 text-[11px] uppercase tracking-wide text-base-content/40">Active alerts</div>
          </div>
        </div>

        <!-- Sites table -->
        @if (sites().length === 0) {
          <div class="rounded-2xl border border-dashed border-base-300/50 py-16 text-center">
            <p class="text-base font-medium">No sites yet</p>
            <p class="text-sm text-base-content/50 mt-1">Onboard a customer to create their first site.</p>
            <a routerLink="/partner/customers/new" class="btn btn-sm rounded-full border-0 bg-cyan-400 text-slate-950 hover:bg-cyan-300 mt-5">New customer</a>
          </div>
        } @else {
          <div class="surface overflow-x-auto">
            <table class="table table-sm">
              <thead>
                <tr class="text-base-content/50">
                  <th>Site</th>
                  <th>Customer</th>
                  <th>Status</th>
                  <th class="text-center">Alerts</th>
                  <th>Last activity</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                @for (s of sites(); track s.id) {
                  <tr class="hover">
                    <td class="font-medium">{{ s.friendlyName }}</td>
                    <td class="text-base-content/70">{{ ownerNames(s) }}</td>
                    <td>
                      @if (s.deviceCount === 0) {
                        <span class="badge badge-ghost badge-sm">No devices</span>
                      } @else if (s.liveCount >= s.deviceCount) {
                        <span class="badge badge-success badge-sm">Live</span>
                      } @else {
                        <span class="badge badge-warning badge-sm">{{ s.liveCount }}/{{ s.deviceCount }} live</span>
                      }
                    </td>
                    <td class="text-center">
                      @if (alertCount(s.id); as n) {
                        <span class="badge badge-error badge-sm">{{ n }}</span>
                      } @else {
                        <span class="text-base-content/30">0</span>
                      }
                    </td>
                    <td class="text-base-content/50 text-xs">{{ date(s.updated) }}</td>
                    <td>
                      <a [routerLink]="['/site', s.id, 'dashboard']" class="btn btn-xs btn-ghost text-cyan-300">Open</a>
                    </td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
        }

        <!-- Recent incidents -->
        <div>
          <h2 class="text-sm font-semibold text-base-content/70 mb-2">Recent incidents</h2>
          @if (incidents().length === 0) {
            <div class="surface px-5 py-6 text-sm text-base-content/40 text-center">No incidents yet — quiet fleet.</div>
          } @else {
            <div class="surface divide-y divide-base-300/20">
              @for (i of incidents(); track i.id) {
                <div class="flex items-center gap-3 px-5 py-2.5">
                  <span class="w-2 h-2 rounded-full shrink-0" [class]="i.status === 'active' ? 'bg-error' : 'bg-success'"></span>
                  <span class="text-sm font-medium shrink-0">{{ kindLabel(i.kind) }}</span>
                  <a [routerLink]="['/site', i.site, 'dashboard']" class="text-sm text-base-content/60 link link-hover truncate">{{ siteName(i.site) }}</a>
                  @if (i.subject) { <span class="hidden md:inline text-xs text-base-content/40 truncate">{{ i.subject }}</span> }
                  <span class="flex-1"></span>
                  <span class="badge badge-xs shrink-0" [class]="i.status === 'active' ? 'badge-error' : 'badge-ghost'">{{ i.status }}</span>
                  <span class="text-xs text-base-content/40 shrink-0 w-16 text-right">{{ ago(i.updated) }}</span>
                </div>
              }
            </div>
          }
        </div>
      }
    </div>
  `,
})
export class PartnerHomeComponent implements OnInit {
  private customersStore = inject(CustomersStore);
  private sitesStore = inject(SitesStore);
  private partner = inject(PartnerService);
  protected branding = inject(BrandingService);

  protected loading = signal(true);
  protected incidents = signal<IncidentEntry[]>([]);
  protected alertCounts = signal<Map<string, number>>(new Map());

  protected customers = computed(() => this.customersStore.list());
  protected sites = computed(() => this.sitesStore.value());
  protected liveControllers = computed(() => this.sites().reduce((n, s) => n + s.liveCount, 0));
  protected totalControllers = computed(() => this.sites().reduce((n, s) => n + s.deviceCount, 0));
  protected offlineControllers = computed(() => this.totalControllers() - this.liveControllers());
  protected activeAlerts = computed(() => [...this.alertCounts().values()].reduce((a, b) => a + b, 0));

  private customerById = computed(() => new Map(this.customers().map((c) => [c.id, c] as const)));
  private siteById = computed(() => new Map(this.sites().map((s) => [s.id, s] as const)));

  async ngOnInit() {
    try {
      await Promise.all([
        this.sitesStore.ensureLoaded(),
        this.customersStore.ensureLoaded().catch(() => []),
      ]);
      const [counts, recent] = await Promise.all([
        this.partner.activeIncidentCounts().catch(() => new Map<string, number>()),
        this.partner.recentIncidents().catch(() => []),
      ]);
      this.alertCounts.set(counts);
      this.incidents.set(recent);
    } finally {
      this.loading.set(false);
    }
  }

  protected ownerNames(s: SiteCatalogItem): string {
    if (!s.owners.length) return 'Unassigned';
    return s.owners
      .map((id) => {
        const c = this.customerById().get(id);
        return c ? c.name || c.email : 'Owner';
      })
      .join(', ');
  }

  protected siteName(id: string): string {
    return this.siteById().get(id)?.friendlyName ?? 'Site';
  }

  protected alertCount(siteId: string): number {
    return this.alertCounts().get(siteId) ?? 0;
  }

  protected kindLabel(kind: string): string {
    return KIND_LABELS[kind] ?? kind;
  }

  protected date(iso: string): string {
    return fmtDate(iso);
  }

  protected ago(iso: string): string {
    return ago(iso);
  }
}
