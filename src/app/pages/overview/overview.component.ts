import { Component, inject, OnInit, signal } from '@angular/core';
import { Router } from '@angular/router';
import { ElectronService } from '../../core/services/electron.service';
import { ConfirmService } from '../../core/services/confirm.service';
import type { SiteListEntry } from '../../core/models/electron-api';

/** Generate a stable color from a string for site card visuals. */
function siteColor(name: string): string {
  const COLORS = ['#0284C7', '#059669', '#D97706', '#7C3AED', '#DB2777', '#0891B2'];
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = ((hash << 5) - hash + name.charCodeAt(i)) | 0;
  return COLORS[Math.abs(hash) % COLORS.length];
}

/** Extract initials (up to 2 chars) from a friendly name. */
function initials(name: string): string {
  return name.split(/\s+/).slice(0, 2).map(w => w[0]?.toUpperCase() ?? '').join('');
}

@Component({
  selector: 'app-overview',
  standalone: true,
  host: { class: 'flex-1 overflow-auto' },
  template: `
    <div class="flex-1 flex flex-col h-full overflow-auto">
      <div class="max-w-5xl mx-auto w-full px-8 py-8">
        <!-- Page header -->
        <div class="mb-8">
          <h1 class="text-2xl font-bold tracking-tight">Sites</h1>
          <p class="text-sm text-base-content/50 mt-1">Select a site to view its water network</p>
        </div>

        <!-- Legacy import banner -->
        @if (hasLegacy()) {
          <div class="alert alert-info mb-6">
            <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
              <path stroke-linecap="round" stroke-linejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
            </svg>
            <div class="flex-1">
              <div class="font-semibold text-sm">Legacy sites found</div>
              <p class="text-xs opacity-70">Old YAML-based sites were found in your store. Import them into the new database.</p>
            </div>
            <button class="btn btn-sm btn-primary" [disabled]="importing()" (click)="importLegacy()">
              @if (importing()) { <span class="loading loading-spinner loading-xs"></span> }
              Import
            </button>
            <button class="btn btn-sm btn-ghost" (click)="hasLegacy.set(false)">Dismiss</button>
          </div>
        }

        @if (loading()) {
          <div class="flex-1 flex items-center justify-center py-24">
            <span class="loading loading-spinner loading-lg"></span>
          </div>
        } @else {
          <div class="grid grid-cols-1 lg:grid-cols-2 gap-6">

            <!-- New site card -->
            <button
              class="card card-side bg-base-100/50 border-2 border-dashed border-base-300/60 hover:border-primary/40 hover:bg-base-100 transition-all cursor-pointer group min-h-[140px]"
              (click)="showCreate.set(true)"
            >
              <div class="card-body flex-row items-center justify-center gap-4 p-6">
                <div class="w-14 h-14 rounded-2xl bg-base-200/80 group-hover:bg-primary/10 flex items-center justify-center transition-colors">
                  <svg xmlns="http://www.w3.org/2000/svg" class="h-7 w-7 text-base-content/30 group-hover:text-primary/60 transition-colors" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
                    <path stroke-linecap="round" stroke-linejoin="round" d="M12 4v16m8-8H4" />
                  </svg>
                </div>
                <div class="text-left">
                  <span class="text-base font-semibold text-base-content/40 group-hover:text-primary/70 transition-colors">New Site</span>
                  <p class="text-xs text-base-content/30 mt-0.5">Create a new water network site</p>
                </div>
              </div>
            </button>

            <!-- Import site card -->
            <button
              class="card card-side bg-base-100/50 border-2 border-dashed border-base-300/60 hover:border-primary/40 hover:bg-base-100 transition-all cursor-pointer group min-h-[140px]"
              (click)="importSite()"
            >
              <div class="card-body flex-row items-center justify-center gap-4 p-6">
                <div class="w-14 h-14 rounded-2xl bg-base-200/80 group-hover:bg-primary/10 flex items-center justify-center transition-colors">
                  <svg xmlns="http://www.w3.org/2000/svg" class="h-7 w-7 text-base-content/30 group-hover:text-primary/60 transition-colors" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
                    <path stroke-linecap="round" stroke-linejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                  </svg>
                </div>
                <div class="text-left">
                  <span class="text-base font-semibold text-base-content/40 group-hover:text-primary/70 transition-colors">Import Site</span>
                  <p class="text-xs text-base-content/30 mt-0.5">Load a site from a .json file</p>
                </div>
              </div>
            </button>

            <!-- Boards card -->
            <button
              class="card card-side bg-base-100/50 border-2 border-dashed border-base-300/60 hover:border-primary/40 hover:bg-base-100 transition-all cursor-pointer group min-h-[140px]"
              (click)="openBoards()"
            >
              <div class="card-body flex-row items-center justify-center gap-4 p-6">
                <div class="w-14 h-14 rounded-2xl bg-base-200/80 group-hover:bg-primary/10 flex items-center justify-center transition-colors">
                  <svg xmlns="http://www.w3.org/2000/svg" class="h-7 w-7 text-base-content/30 group-hover:text-primary/60 transition-colors" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
                    <path stroke-linecap="round" stroke-linejoin="round" d="M9 3v2m6-2v2M9 19v2m6-2v2M5 9H3m2 6H3m18-6h-2m2 6h-2M7 19h10a2 2 0 002-2V7a2 2 0 00-2-2H7a2 2 0 00-2 2v10a2 2 0 002 2zM9 9h6v6H9V9z" />
                  </svg>
                </div>
                <div class="text-left">
                  <span class="text-base font-semibold text-base-content/40 group-hover:text-primary/70 transition-colors">Boards</span>
                  <p class="text-xs text-base-content/30 mt-0.5">Manage boards and run hardware self-tests</p>
                </div>
              </div>
            </button>

            <!-- Site cards -->
            @for (site of entries(); track site.id) {
              <div
                class="card card-side bg-base-100 shadow-sm border border-base-300/50 hover:border-primary/30 hover:shadow-md transition-all cursor-pointer group min-h-[140px]"
                (click)="openSite(site.id)"
              >
                <!-- Visual: initials badge -->
                <figure class="pl-6 flex items-center shrink-0">
                  <div
                    class="w-14 h-14 rounded-2xl flex items-center justify-center text-white font-bold text-lg shadow-sm"
                    [style.backgroundColor]="getColor(site.id)"
                  >
                    {{ getInitials(site.friendlyName) }}
                  </div>
                </figure>

                <div class="card-body p-5 gap-1 min-w-0">
                  @if (renamingId() === site.id) {
                    <input
                      class="input input-sm input-bordered font-semibold text-base w-full"
                      [value]="site.friendlyName"
                      (keydown.enter)="confirmRename(site.id, $event)"
                      (keydown.escape)="renamingId.set(null)"
                      (blur)="confirmRename(site.id, $event)"
                      (click)="$event.stopPropagation()"
                      #renameInput
                    />
                  } @else {
                    <h2
                      class="card-title text-base group-hover:text-primary transition-colors cursor-text"
                      (dblclick)="startRename(site.id, $event)"
                    >{{ site.friendlyName }}</h2>
                  }
                  <p class="text-xs text-base-content/40 font-mono truncate">{{ site.id }}</p>
                  <div class="flex items-center gap-4 mt-2 text-xs text-base-content/50">
                    <div class="flex items-center gap-1.5">
                      <svg xmlns="http://www.w3.org/2000/svg" class="h-3.5 w-3.5 opacity-50" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                        <path stroke-linecap="round" stroke-linejoin="round" d="M9 3v2m6-2v2M9 19v2m6-2v2M5 9H3m2 6H3m18-6h-2m2 6h-2M7 19h10a2 2 0 002-2V7a2 2 0 00-2-2H7a2 2 0 00-2 2v10a2 2 0 002 2zM9 9h6v6H9V9z" />
                      </svg>
                      {{ site.systemCount }} controller{{ site.systemCount !== 1 ? 's' : '' }}
                    </div>
                    <div class="flex items-center gap-1.5">
                      <svg xmlns="http://www.w3.org/2000/svg" class="h-3.5 w-3.5 opacity-50" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                        <path stroke-linecap="round" stroke-linejoin="round" d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
                      </svg>
                      {{ site.linkCount }} link{{ site.linkCount !== 1 ? 's' : '' }}
                    </div>
                  </div>
                  <div class="card-actions justify-end mt-1">
                    <button
                      class="btn btn-ghost btn-xs text-base-content/30 opacity-0 group-hover:opacity-100 transition-opacity"
                      (click)="startRename(site.id, $event)"
                    >Rename</button>
                    <button
                      class="btn btn-ghost btn-xs text-base-content/30 opacity-0 group-hover:opacity-100 transition-opacity"
                      (click)="exportSite(site.id, $event)"
                    >Export</button>
                    <button
                      class="btn btn-ghost btn-xs text-base-content/30 hover:text-error opacity-0 group-hover:opacity-100 transition-opacity"
                      (click)="deleteSite(site.id, site.friendlyName, $event)"
                    >Delete</button>
                  </div>
                </div>
              </div>
            }
          </div>

          @if (entries().length === 0) {
            <div class="flex items-center justify-center py-12 text-base-content/30">
              <div class="text-center">
                <svg xmlns="http://www.w3.org/2000/svg" class="h-16 w-16 mx-auto mb-4 opacity-30" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7" />
                </svg>
                <p class="text-lg font-medium">No sites yet</p>
                <p class="text-sm mt-1">Click the card above to create your first site.</p>
              </div>
            </div>
          }
        }
      </div>

      <!-- Create site dialog -->
      @if (showCreate()) {
        <dialog class="modal modal-open">
          <div class="modal-box max-w-sm">
            <h3 class="font-bold text-lg mb-4">New Site</h3>
            <div class="form-control">
              <label class="label"><span class="label-text">Site name</span></label>
              <input
                type="text"
                class="input input-bordered w-full"
                placeholder="My Farm"
                #newName
                (keydown.enter)="createSite(newName.value)"
              />
            </div>
            <div class="modal-action">
              <button class="btn btn-ghost" (click)="showCreate.set(false)">Cancel</button>
              <button class="btn btn-primary" (click)="createSite(newName.value)">Create</button>
            </div>
          </div>
          <div class="modal-backdrop" (click)="showCreate.set(false)"></div>
        </dialog>
      }
    </div>
  `,
})
export class OverviewComponent implements OnInit {
  private electron = inject(ElectronService);
  private router = inject(Router);
  private confirmService = inject(ConfirmService);

  protected entries = signal<SiteListEntry[]>([]);
  protected loading = signal(true);
  protected showCreate = signal(false);
  protected hasLegacy = signal(false);
  protected importing = signal(false);
  protected renamingId = signal<string | null>(null);

  async ngOnInit() {
    await this.refresh();
    // Check for legacy data once
    this.hasLegacy.set(await this.electron.legacyHasData());
  }

  private async refresh() {
    this.loading.set(true);
    this.entries.set(await this.electron.siteList());
    this.loading.set(false);
  }

  protected getColor(name: string): string {
    return siteColor(name);
  }

  protected getInitials(name: string): string {
    return initials(name);
  }

  protected openSite(id: string): void {
    this.router.navigate(['/site', id]);
  }

  protected openBoards(): void {
    this.router.navigate(['/boards']);
  }

  protected async createSite(friendlyName: string): Promise<void> {
    if (!friendlyName.trim()) return;
    const slug = friendlyName.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    await this.electron.siteCreate(slug, friendlyName.trim());
    await this.refresh();
    this.showCreate.set(false);
    this.router.navigate(['/site', slug]);
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
      await this.electron.siteRename(id, newName);
      await this.refresh();
    }
    this.renamingId.set(null);
  }

  protected async exportSite(id: string, event: Event): Promise<void> {
    event.stopPropagation();
    await this.electron.siteExport(id);
  }

  protected async importSite(): Promise<void> {
    const result = await this.electron.siteImport();
    if (result.ok) {
      await this.refresh();
      if (result.siteId) {
        this.router.navigate(['/site', result.siteId]);
      }
    }
  }

  protected async deleteSite(id: string, name: string, event: Event): Promise<void> {
    event.stopPropagation();
    const confirmed = await this.confirmService.confirm({
      title: 'Delete Site',
      message: `Delete "${name}"? All controllers and links in this site will be permanently removed.`,
    });
    if (!confirmed) return;
    await this.electron.siteDelete(id);
    await this.refresh();
  }

  protected async importLegacy(): Promise<void> {
    this.importing.set(true);
    try {
      const scanned = await this.electron.legacyScan();
      if (scanned.sites.length > 0) {
        const result = await this.electron.legacyImport(scanned.sites);
        if (result.imported > 0) {
          await this.refresh();
        }
      }
      this.hasLegacy.set(false);
    } finally {
      this.importing.set(false);
    }
  }
}
