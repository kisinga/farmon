import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { Router } from '@angular/router';
import { BackendService } from '../../core/services/backend.service';
import { ConfigStore } from '../../core/stores/config.store';
import { SitesStore } from '../../core/stores/sites.store';
import { ConfirmService } from '../../core/services/confirm.service';
import type { SiteListEntry } from '../../core/models/backend-api';
import { HOSTING_DEVICE_CAP } from '@core';
import { SectionHeaderComponent } from '../editor/shared/section-header.component';

/** Generate a stable color from a string for site card visuals. */
function siteColor(name: string): string {
  const COLORS = ['#0EA5E9', '#22D3EE', '#34D399', '#A78BFA', '#F472B6', '#FBBF24'];
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = ((hash << 5) - hash + name.charCodeAt(i)) | 0;
  return COLORS[Math.abs(hash) % COLORS.length];
}

/** Extract initials (up to 2 chars) from a friendly name. */
function initials(name: string): string {
  return name.split(/\s+/).slice(0, 2).map(w => w[0]?.toUpperCase() ?? '').join('');
}

/**
 * Sites catalog (admin home). A bright cyan-gradient hero band (title + primary
 * actions) over a darker card grid — the "dark and bright zones" balance from
 * the public site. Each card carries a colour-coded badge (the per-card pop),
 * a cyan-glow hover, a Live view action (admin monitoring), and a kebab for
 * Rename / Export / Delete.
 */
@Component({
  selector: 'app-overview',
  standalone: true,
  imports: [SectionHeaderComponent],
  host: { class: 'flex-1 overflow-auto' },
  template: `
    <div class="content-pane space-y-6">

      <div class="flex items-start justify-between gap-4 flex-wrap">
        <app-section-header title="Sites" subtitle="Your water networks. Open one to design it, or watch it live." />
        <div class="flex items-center gap-2 shrink-0">
          <label class="btn btn-sm btn-ghost gap-1.5 ring-1 ring-white/10 cursor-pointer">
            <input type="file" accept=".json" class="hidden" (change)="importSite($event)" />
            <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
              <path stroke-linecap="round" stroke-linejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
            </svg>
            Import
          </label>
          <button class="btn btn-sm rounded-full border-0 bg-cyan-400 text-slate-950 hover:bg-cyan-300 gap-1.5 shadow-lg shadow-cyan-500/20"
            (click)="showCreate.set(true)">
            <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5">
              <path stroke-linecap="round" stroke-linejoin="round" d="M12 4v16m8-8H4" />
            </svg>
            New site
          </button>
        </div>
      </div>

      @if (loading()) {
        <div class="flex items-center justify-center py-24"><span class="loading loading-spinner loading-lg text-cyan-400"></span></div>
      } @else if (entries().length === 0) {
        <div class="rounded-2xl border border-dashed border-base-300/50 py-16 text-center">
          <svg xmlns="http://www.w3.org/2000/svg" class="h-14 w-14 mx-auto mb-4 text-base-content/20" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1">
            <path stroke-linecap="round" stroke-linejoin="round" d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7" />
          </svg>
          <p class="text-base font-medium">No sites yet</p>
          <p class="text-sm text-base-content/50 mt-1">Create your first water network to get started.</p>
          <button class="btn btn-sm rounded-full border-0 bg-cyan-400 text-slate-950 hover:bg-cyan-300 mt-5" (click)="showCreate.set(true)">New site</button>
        </div>
      } @else {
        <div class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
          @for (site of entries(); track site.id) {
            <div
              class="group relative rounded-2xl bg-base-100 ring-1 ring-base-300/40 hover:ring-cyan-400/40 transition-all hover:-translate-y-0.5 cursor-pointer"
              (click)="openSite(site.id)"
            >
              <!-- Decorative layer, clipped to the rounded card. Kept off the card
                   itself so the kebab menu isn't clipped by overflow-hidden. -->
              <div class="absolute inset-0 rounded-2xl overflow-hidden pointer-events-none">
                <div class="absolute inset-x-0 top-0 h-1 opacity-80" [style.backgroundColor]="getColor(site.id)"></div>
                <div class="absolute -top-10 -right-10 w-32 h-32 rounded-full bg-cyan-500/0 group-hover:bg-cyan-500/10 blur-2xl transition-all duration-300"></div>
              </div>

              <div class="relative p-5 flex gap-4">
                <div class="w-14 h-14 rounded-2xl flex items-center justify-center text-white font-bold text-lg shadow-lg shrink-0"
                  [style.backgroundColor]="getColor(site.id)">
                  {{ getInitials(site.friendlyName) }}
                </div>
                <div class="flex-1 min-w-0">
                  @if (renamingId() === site.id) {
                    <input
                      class="input input-sm input-bordered font-semibold text-base w-full"
                      [value]="site.friendlyName"
                      (keydown.enter)="confirmRename(site.id, $event)"
                      (keydown.escape)="renamingId.set(null)"
                      (blur)="confirmRename(site.id, $event)"
                      (click)="$event.stopPropagation()"
                    />
                  } @else {
                    <h2 class="font-semibold text-base truncate group-hover:text-cyan-300 transition-colors">{{ site.friendlyName }}</h2>
                  }
                  <p class="text-xs text-base-content/40 font-mono truncate mt-0.5">{{ site.id }}</p>
                  <div class="flex items-center gap-4 mt-2 text-xs text-base-content/50">
                    <span class="flex items-center gap-1.5">
                      <svg xmlns="http://www.w3.org/2000/svg" class="h-3.5 w-3.5 opacity-60" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                        <path stroke-linecap="round" stroke-linejoin="round" d="M9 3v2m6-2v2M9 19v2m6-2v2M5 9H3m2 6H3m18-6h-2m2 6h-2M7 19h10a2 2 0 002-2V7a2 2 0 00-2-2H7a2 2 0 00-2 2v10a2 2 0 002 2zM9 9h6v6H9V9z" />
                      </svg>
                      {{ site.controllerCount }} controller{{ site.controllerCount !== 1 ? 's' : '' }}
                    </span>
                    <span class="flex items-center gap-1.5">
                      <svg xmlns="http://www.w3.org/2000/svg" class="h-3.5 w-3.5 opacity-60" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                        <path stroke-linecap="round" stroke-linejoin="round" d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
                      </svg>
                      {{ site.nodeCount }} node{{ site.nodeCount !== 1 ? 's' : '' }}
                    </span>
                  </div>

                  <!-- Hosting (managed sites only): device usage vs cap + renewal clock. -->
                  @if (hosting(site); as h) {
                    <div class="flex flex-wrap items-center gap-x-3 gap-y-1 mt-2 text-xs">
                      <span class="flex items-center gap-1.5"
                            [class]="h.atCap ? 'text-amber-400' : 'text-base-content/50'"
                            [title]="h.atCap ? 'Hosting plan device limit reached' : 'Provisioned devices'">
                        <svg xmlns="http://www.w3.org/2000/svg" class="h-3.5 w-3.5 opacity-60" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                          <path stroke-linecap="round" stroke-linejoin="round" d="M5 12h14M5 12a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v4a2 2 0 01-2 2M5 12a2 2 0 00-2 2v4a2 2 0 002 2h14a2 2 0 002-2v-4a2 2 0 00-2-2m-2-4h.01M17 16h.01" />
                        </svg>
                        {{ site.deviceCount }} / {{ cap() }} devices
                      </span>
                      @if (h.commenced) {
                        <span class="flex items-center gap-1.5"
                              [class]="h.overdue ? 'text-red-400' : 'text-base-content/40'"
                              [title]="'Hosting since ' + h.sinceLabel">
                          <svg xmlns="http://www.w3.org/2000/svg" class="h-3.5 w-3.5 opacity-60" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                            <path stroke-linecap="round" stroke-linejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                          </svg>
                          {{ h.renewalLabel }}
                        </span>
                      } @else {
                        <span class="text-base-content/30">Not yet commissioned</span>
                      }
                    </div>
                  }
                </div>
              </div>

              <!-- Footer actions -->
              <div class="relative flex items-center gap-1 px-4 py-3 border-t border-base-300/30 bg-base-200/40 rounded-b-2xl">
                <button class="btn btn-xs btn-ghost gap-1.5 text-cyan-300 hover:bg-cyan-400/10"
                  (click)="openDashboard(site.id, $event)" title="Open this site's live dashboard">
                  <svg xmlns="http://www.w3.org/2000/svg" class="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                    <path stroke-linecap="round" stroke-linejoin="round" d="M22 12h-4l-3 9L9 3l-3 9H2" />
                  </svg>
                  Live view
                </button>
                <span class="flex-1"></span>
                <div class="dropdown dropdown-top dropdown-end" (click)="$event.stopPropagation()">
                  <button tabindex="0" class="btn btn-xs btn-ghost btn-square" title="More">
                    <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                      <path stroke-linecap="round" stroke-linejoin="round" d="M12 5v.01M12 12v.01M12 19v.01" />
                    </svg>
                  </button>
                  <ul tabindex="0" class="dropdown-content menu bg-base-100 rounded-box shadow-lg border border-base-300/40 z-50 w-36 p-1.5">
                    <li><button (click)="startRename(site.id, $event)">Rename</button></li>
                    <li><button (click)="exportSite(site.id, $event)">Export</button></li>
                    <li><button class="text-error" (click)="deleteSite(site.id, site.friendlyName, $event)">Delete</button></li>
                  </ul>
                </div>
              </div>
            </div>
          }
        </div>
      }
    </div>

    <!-- Create site dialog -->
    @if (showCreate()) {
      <dialog class="modal modal-open">
        <div class="modal-box max-w-sm">
          <h3 class="font-bold text-lg mb-4">New site</h3>
          <label class="form-control">
            <span class="label-text mb-1">Site name</span>
            <input type="text" class="input input-bordered w-full" placeholder="e.g. Riverside Farm" #newName (keydown.enter)="createSite(newName.value)" />
          </label>
          <div class="modal-action">
            <button class="btn btn-ghost" (click)="showCreate.set(false)">Cancel</button>
            <button class="btn border-0 bg-cyan-400 text-slate-950 hover:bg-cyan-300" (click)="createSite(newName.value)">Create</button>
          </div>
        </div>
        <div class="modal-backdrop" (click)="showCreate.set(false)"></div>
      </dialog>
    }
  `,
})
export class OverviewComponent implements OnInit {
  private backend = inject(BackendService);
  private configStore = inject(ConfigStore);
  private sitesStore = inject(SitesStore);
  private router = inject(Router);
  private confirmService = inject(ConfirmService);

  protected entries = computed(() => this.sitesStore.list());
  protected loading = signal(true);
  protected showCreate = signal(false);
  protected renamingId = signal<string | null>(null);
  /** Hosting device cap, loaded from server config (HOSTING_DEVICE_CAP is the fallback). */
  protected cap = signal(HOSTING_DEVICE_CAP);

  async ngOnInit() {
    await this.refresh();
  }

  private async refresh() {
    this.loading.set(true);
    await Promise.all([
      this.sitesStore.ensureLoaded(),
      this.configStore.ensureLoaded(),
    ]);
    this.cap.set(this.configStore.cap());
    this.loading.set(false);
  }

  protected getColor(name: string): string {
    return siteColor(name);
  }

  /**
   * Hosting view-model for a site card, or null for on-prem (local) sites that
   * carry no hosting clock. An unset mode is treated as managed, matching the
   * firmware-generation default. `commenced` is false until the first device is
   * provisioned (no commence_date yet); renewal is one year from that date.
   */
  protected hosting(site: SiteListEntry): {
    atCap: boolean;
    commenced: boolean;
    sinceLabel: string;
    renewalLabel: string;
    overdue: boolean;
  } | null {
    if (site.mode === 'local') return null;
    const atCap = site.deviceCount >= this.cap();
    if (!site.commenceDate) {
      return { atCap, commenced: false, sinceLabel: '', renewalLabel: '', overdue: false };
    }
    const fmt = (d: Date) =>
      d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
    const start = new Date(site.commenceDate);
    const renewal = new Date(start);
    renewal.setFullYear(renewal.getFullYear() + 1);
    const days = Math.ceil((renewal.getTime() - Date.now()) / 86_400_000);
    const overdue = days <= 0;
    return {
      atCap,
      commenced: true,
      sinceLabel: fmt(start),
      renewalLabel: overdue ? `Renewal overdue (${fmt(renewal)})` : `Renews ${fmt(renewal)} (${days}d)`,
      overdue,
    };
  }

  protected getInitials(name: string): string {
    return initials(name);
  }

  protected openSite(id: string): void {
    this.router.navigate(['/site', id]);
  }

  /** Open a site's live dashboard (admin monitoring — read-only by default). */
  protected openDashboard(id: string, event: Event): void {
    event.stopPropagation();
    this.router.navigate(['/site', id, 'dashboard']);
  }

  protected async createSite(friendlyName: string): Promise<void> {
    if (!friendlyName.trim()) return;
    const slug = friendlyName.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    const { id } = await this.sitesStore.create(slug, friendlyName.trim());
    this.showCreate.set(false);
    this.router.navigate(['/site', id]);
  }

  protected startRename(id: string, event: Event): void {
    event.stopPropagation();
    this.renamingId.set(id);
  }

  protected async confirmRename(id: string, event: Event): Promise<void> {
    event.stopPropagation();
    const input = event.target as HTMLInputElement;
    const newName = input.value.trim();
    if (newName) {
      await this.sitesStore.rename(id, newName);
    }
    this.renamingId.set(null);
  }

  protected async exportSite(id: string, event: Event): Promise<void> {
    event.stopPropagation();
    const { json } = await this.backend.siteExport(id);
    if (json) {
      const blob = new Blob([json], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `site-${id}.json`;
      a.click();
      URL.revokeObjectURL(url);
    }
  }

  protected async importSite(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const { id } = await this.sitesStore.import(text);
      this.router.navigate(['/site', id]);
    } catch (err) {
      console.error('Site import failed:', err);
      alert(`Import failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      input.value = '';
    }
  }

  protected async deleteSite(id: string, name: string, event: Event): Promise<void> {
    event.stopPropagation();
    const confirmed = await this.confirmService.confirm({
      title: 'Delete Site',
      message: `Delete "${name}"? All controllers and links in this site will be permanently removed.`,
    });
    if (!confirmed) return;
    await this.sitesStore.delete(id);
  }
}
