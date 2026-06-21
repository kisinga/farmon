import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { Router } from '@angular/router';
import { BackendService } from '../../core/services/backend.service';
import { ConfigStore } from '../../core/stores/config.store';
import { SitesStore } from '../../core/stores/sites.store';
import { ConfirmService } from '../../core/services/confirm.service';
import { AuthStore } from '../../core/services/auth.store';
import { CustomersStore } from '../../core/stores/customers.store';
import type { SiteListEntry } from '../../core/models/backend-api';
import { HOSTING_DEVICE_CAP } from '@core';
import { SectionHeaderComponent } from '../editor/shared/section-header.component';
import { AssignPickerComponent, type AssignItem } from '../../shared/assign-picker/assign-picker.component';
import { EasyModeComponent } from './easy-mode.component';
import { siteColor, initials } from '../../core/util/site-colors';

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
  imports: [SectionHeaderComponent, AssignPickerComponent, EasyModeComponent],
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
          <button class="btn btn-sm rounded-full border-0 bg-emerald-400 text-slate-950 hover:bg-emerald-300 gap-1.5 shadow-lg shadow-emerald-500/20"
            (click)="showEasy.set(true)">
            <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5">
              <path stroke-linecap="round" stroke-linejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
            </svg>
            Quick setup
          </button>
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
        <div class="grid grid-cols-[repeat(auto-fill,minmax(min(100%,20rem),1fr))] gap-5">
          @for (site of entries(); track site.id) {
            <div
              class="group relative h-full flex flex-col rounded-2xl bg-base-100 ring-1 ring-base-300/40 hover:ring-cyan-400/40 transition-all hover:-translate-y-0.5 cursor-pointer"
              (click)="openDashboard(site.id, $event)"
            >
              <!-- Decorative layer, clipped to the rounded card. Kept off the card
                   itself so the kebab menu isn't clipped by overflow-hidden. A thin
                   left accent (not a full top stripe) carries the per-site colour. -->
              <div class="absolute inset-0 rounded-2xl overflow-hidden pointer-events-none">
                <div class="absolute inset-y-0 left-0 w-1 opacity-70" [style.backgroundColor]="getColor(site.id)"></div>
                <div class="absolute -top-10 -right-10 w-32 h-32 rounded-full bg-cyan-500/0 group-hover:bg-cyan-500/10 blur-2xl transition-all duration-300"></div>
              </div>

              <!-- Header: avatar + name/id, with the lifecycle badge on its own line
                   (keeps the name full-width so it never truncates prematurely). -->
              <div class="relative p-4 pl-5 flex items-start gap-3">
                <div class="w-12 h-12 rounded-xl flex items-center justify-center text-white font-bold shadow-md shrink-0"
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
                  @if (status(site); as s) {
                    <span class="inline-flex items-center gap-1.5 mt-2 rounded-full px-2 py-0.5 text-[11px] font-medium"
                          [class]="badgeClass(s.tone)">
                      <span class="w-1.5 h-1.5 rounded-full" [class]="dotClass(s.tone)"></span>
                      {{ s.label }}
                    </span>
                  }
                </div>
              </div>

              <!-- Stat grid: fixed cells so counts never wrap. Devices is managed-only. -->
              <div class="relative px-4 py-3 mt-1 grid divide-x divide-base-300/30 text-center border-t border-base-300/20"
                   [class]="hosting(site) ? 'grid-cols-3' : 'grid-cols-2'">
                <div class="px-2">
                  <div class="text-lg font-semibold tabular-nums leading-none">{{ site.controllerCount }}</div>
                  <div class="mt-1 text-[11px] uppercase tracking-wide text-base-content/40">Controllers</div>
                </div>
                <div class="px-2">
                  <div class="text-lg font-semibold tabular-nums leading-none">{{ site.nodeCount }}</div>
                  <div class="mt-1 text-[11px] uppercase tracking-wide text-base-content/40">Nodes</div>
                </div>
                @if (hosting(site); as h) {
                  <div class="px-2"
                       [title]="h.atCap ? 'Hosting plan device limit reached' : 'Provisioned devices'">
                    <div class="text-lg font-semibold tabular-nums leading-none"
                         [class]="h.atCap ? 'text-amber-400' : ''">{{ site.deviceCount }} / {{ cap() }}</div>
                    <div class="mt-1 text-[11px] uppercase tracking-wide text-base-content/40">Devices</div>
                  </div>
                }
              </div>

              <!-- Renewal clock (managed + commissioned only). -->
              @if (hosting(site); as h) {
                @if (h.commenced) {
                  <div class="relative px-5 pb-1 flex items-center gap-1.5 text-[11px]"
                       [class]="h.overdue ? 'text-error' : 'text-base-content/40'"
                       [title]="'Hosting since ' + h.sinceLabel">
                    <svg xmlns="http://www.w3.org/2000/svg" class="h-3.5 w-3.5 opacity-60" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                      <path stroke-linecap="round" stroke-linejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    {{ h.renewalLabel }}
                  </div>
                }
              }

              <!-- Footer actions. The card body opens Live view (the everyday action);
                   Design is the deliberate edit path. -->
              <div class="relative mt-auto flex items-center gap-1 px-3 py-2.5 border-t border-base-300/30 bg-base-200/40 rounded-b-2xl">
                <button class="btn btn-xs btn-ghost gap-1.5 text-cyan-300 hover:bg-cyan-400/10"
                  (click)="openDashboard(site.id, $event)" title="Open this site's live dashboard">
                  <svg xmlns="http://www.w3.org/2000/svg" class="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                    <path stroke-linecap="round" stroke-linejoin="round" d="M22 12h-4l-3 9L9 3l-3 9H2" />
                  </svg>
                  Live view
                </button>
                <button class="btn btn-xs btn-ghost gap-1.5 text-base-content/60 hover:text-base-content"
                  (click)="openDesign(site.id, $event)" title="Open the design editor">
                  <svg xmlns="http://www.w3.org/2000/svg" class="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                    <path stroke-linecap="round" stroke-linejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                  </svg>
                  Design
                </button>
                <span class="flex-1"></span>
                @if (isAdmin()) {
                  @if (site.owners.length) {
                    <button class="flex items-center -space-x-2 hover:opacity-80 transition-opacity pr-1"
                      (click)="openOwner(site, $event)"
                      [title]="ownersTitle(site.owners)">
                      @for (id of site.owners.slice(0, 3); track id) {
                        <span class="flex items-center justify-center w-6 h-6 rounded-full bg-base-300 ring-2 ring-base-100 text-[10px] font-semibold">{{ getInitials(ownerName(id)) }}</span>
                      }
                      @if (site.owners.length > 3) {
                        <span class="flex items-center justify-center w-6 h-6 rounded-full bg-cyan-400/20 text-cyan-300 ring-2 ring-base-100 text-[10px] font-semibold">+{{ site.owners.length - 3 }}</span>
                      }
                    </button>
                  } @else {
                    <button class="btn btn-xs btn-ghost gap-1 px-1.5 text-amber-400 normal-case"
                      (click)="openOwner(site, $event)" title="Assign customers to this site">
                      <svg xmlns="http://www.w3.org/2000/svg" class="h-3.5 w-3.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                        <path stroke-linecap="round" stroke-linejoin="round" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                      </svg>
                      <span class="truncate">Assign</span>
                    </button>
                  }
                }
                <div class="dropdown dropdown-top dropdown-end" (click)="$event.stopPropagation()">
                  <button tabindex="0" class="btn btn-xs btn-ghost btn-square" title="More">
                    <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                      <path stroke-linecap="round" stroke-linejoin="round" d="M12 5v.01M12 12v.01M12 19v.01" />
                    </svg>
                  </button>
                  <ul tabindex="0" class="dropdown-content menu bg-base-100 rounded-box shadow-lg border border-base-300/40 z-50 w-44 p-1.5">
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

    @if (showEasy()) { <app-easy-mode (close)="showEasy.set(false)" /> }

    <!-- Co-owner assignment dialog (admin): assign any number of customers to this site -->
    @if (ownerModalSite(); as s) {
      <app-assign-picker
        [title]="'Assign customers'"
        [subtitle]="s.friendlyName"
        searchPlaceholder="Search customers by name or email…"
        emptyText="No customers exist yet — add them on the Customers page."
        [items]="customerItems()"
        [selectedIds]="ownerSet()"
        (toggle)="onOwnerToggle(s.id, $event)"
        (clear)="setOwners(s.id, [])"
        (close)="ownerModalId.set(null)" />
    }
  `,
})
export class OverviewComponent implements OnInit {
  private backend = inject(BackendService);
  private configStore = inject(ConfigStore);
  private sitesStore = inject(SitesStore);
  private router = inject(Router);
  private confirmService = inject(ConfirmService);
  private auth = inject(AuthStore);
  private customersStore = inject(CustomersStore);

  protected entries = computed(() => this.sitesStore.list());
  protected loading = signal(true);
  protected showCreate = signal(false);
  protected showEasy = signal(false);
  protected renamingId = signal<string | null>(null);
  protected readonly isAdmin = this.auth.isAdmin;
  /** Customers an admin can assign a site to (shared cache with the Customers page). */
  protected customers = computed(() => this.customersStore.list());
  /** Site whose owner-management dialog is open (tracked by id so it stays live
   *  against the cached list after an assignment patches the owner). */
  protected ownerModalId = signal<string | null>(null);
  protected ownerModalSite = computed(
    () => this.entries().find((s) => s.id === this.ownerModalId()) ?? null,
  );
  /** Customers shaped as picker rows (name primary, email secondary). */
  protected customerItems = computed<AssignItem[]>(() =>
    this.customers().map((c) => ({ id: c.id, label: c.name, sub: c.email })),
  );
  /** The open site's co-owner ids as a Set, for the picker's selected state. */
  protected ownerSet = computed(() => new Set(this.ownerModalSite()?.owners ?? []));
  private customerById = computed(() => new Map(this.customers().map((c) => [c.id, c] as const)));

  /** Resolve a co-owner user id to a display name. Self (an admin-owned site) reads
   *  "You"; a customer reads their name/email; any other id falls back to "Owner"
   *  (e.g. another admin, not in the customer list) rather than a scary "Unknown". */
  protected ownerName(id: string): string {
    if (id && id === this.auth.user()?.id) return 'You';
    const c = this.customerById().get(id);
    return c ? c.name || c.email : 'Owner';
  }

  /** Hover summary for a card's co-owner avatar stack. */
  protected ownersTitle(ids: string[]): string {
    return ids.length
      ? 'Assigned: ' + ids.map((id) => this.ownerName(id)).join(', ') + ' — click to manage'
      : 'Assign customers to this site';
  }
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
    if (this.isAdmin()) {
      await this.customersStore.ensureLoaded().catch(() => []);
    }
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

  /** Lifecycle badge for a site card: on-prem, awaiting commission, live, or overdue. */
  protected status(site: SiteListEntry): { label: string; tone: 'neutral' | 'idle' | 'live' | 'overdue' } {
    const h = this.hosting(site);
    if (!h) return { label: 'On-prem', tone: 'neutral' };
    if (!h.commenced) return { label: 'Not commissioned', tone: 'idle' };
    return h.overdue ? { label: 'Renewal due', tone: 'overdue' } : { label: 'Live', tone: 'live' };
  }

  /** Tailwind pill classes per status tone. */
  protected badgeClass(tone: 'neutral' | 'idle' | 'live' | 'overdue'): string {
    switch (tone) {
      case 'live': return 'bg-success/10 text-success';
      case 'overdue': return 'bg-error/10 text-error';
      default: return 'bg-base-200 text-base-content/60';
    }
  }

  /** Status-dot colour per tone. */
  protected dotClass(tone: 'neutral' | 'idle' | 'live' | 'overdue'): string {
    switch (tone) {
      case 'live': return 'bg-success';
      case 'overdue': return 'bg-error';
      case 'idle': return 'bg-base-content/30';
      default: return 'bg-base-content/40';
    }
  }

  protected getInitials(name: string): string {
    return initials(name);
  }

  /** Open a site's design editor — the deliberate edit path (live view is the default). */
  protected openDesign(id: string, event: Event): void {
    event.stopPropagation();
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

  /** Open the co-owner assignment dialog for a site. */
  protected openOwner(site: SiteListEntry, event: Event): void {
    event.stopPropagation();
    this.ownerModalId.set(site.id);
  }

  /** Add or remove one customer from a site's co-owner set. The store patches the
   *  cached list, so the picker's checkmarks follow automatically. */
  protected onOwnerToggle(siteId: string, e: { id: string; selected: boolean }): Promise<void> {
    return this.sitesStore.toggleOwner(siteId, e.id, e.selected);
  }

  /** Replace a site's whole co-owner set (used by the picker's "Clear all"). */
  protected setOwners(siteId: string, owners: string[]): Promise<void> {
    return this.sitesStore.setOwners(siteId, owners);
  }

  protected async deleteSite(id: string, name: string, event: Event): Promise<void> {
    event.stopPropagation();
    const confirmed = await this.confirmService.confirm({
      title: 'Delete Site',
      message: `Delete "${name}"? All controllers and links in this site will be permanently removed.`,
      confirmLabel: 'Delete',
      variant: 'error',
    });
    if (!confirmed) return;
    await this.sitesStore.delete(id);
  }
}
