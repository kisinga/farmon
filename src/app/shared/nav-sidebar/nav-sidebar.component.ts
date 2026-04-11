import { Component, inject, signal } from '@angular/core';
import { Router, RouterLink, RouterLinkActive } from '@angular/router';
import { WorkspaceService } from '../../core/services/workspace.service';
import { LibraryService } from '../../core/services/library.service';

@Component({
  selector: 'app-nav-sidebar',
  standalone: true,
  imports: [RouterLink, RouterLinkActive],
  host: { class: 'shrink-0 flex h-full' },
  template: `
    <!-- Expanded panel -->
    @if (expanded()) {
      <div class="w-[var(--sidebar-w)] bg-base-100 border-r border-base-300/40 flex flex-col overflow-hidden">
        @if (workspace.site(); as site) {
          <!-- Site header -->
          <div class="px-4 py-4 border-b border-base-300/30">
            <a
              [routerLink]="['/site', workspace.siteName()]"
              class="group flex items-center gap-2.5 hover:opacity-80 transition-opacity"
            >
              <span class="w-2 h-2 rounded-full nav-dot-site shrink-0"></span>
              <div class="min-w-0">
                <h2 class="font-bold text-sm truncate nav-label-site">{{ site.friendly_name }}</h2>
                <p class="text-[10px] text-base-content/40">
                  {{ site.systems.length }} system{{ site.systems.length !== 1 ? 's' : '' }}
                </p>
              </div>
            </a>
          </div>

          <!-- System tree -->
          <div class="flex-1 overflow-y-auto py-1">
            @for (sp of site.systems; track sp.config) {
              @if (getSystem(sp.config); as sys) {
                <a
                  [routerLink]="['/site', workspace.siteName(), 'system', sp.config]"
                  routerLinkActive="bg-base-200/60 border-l-[3px]"
                  [routerLinkActiveOptions]="{ exact: false }"
                  class="flex items-center gap-3 pl-5 pr-3 py-2.5 ml-4 border-l-2 border-l-base-300/40 hover:bg-base-200/40 transition-colors cursor-pointer group"
                  [style.border-left-color]="isSystemActive(sp.config) ? 'var(--nav-layer-system)' : ''"
                >
                  <div class="flex-1 min-w-0">
                    <div class="flex items-center gap-2">
                      <span
                        class="text-sm font-medium truncate transition-colors"
                        [class.nav-label-system]="isSystemActive(sp.config)"
                        [class.group-hover:nav-label-system]="!isSystemActive(sp.config)"
                      >
                        {{ sys.topology.device.friendly_name || sp.config }}
                      </span>
                      <span
                        class="w-2 h-2 rounded-full shrink-0"
                        [class.bg-success]="sp.checksum !== ''"
                        [class.bg-warning]="sp.checksum === ''"
                        [title]="sp.checksum !== '' ? 'Deployed' : 'Not deployed'"
                      ></span>
                    </div>
                    <div class="flex items-center gap-2 mt-0.5">
                      <span class="badge badge-xs badge-ghost text-[9px]">{{ sys.topology.device.board }}</span>
                      <span class="text-[10px] text-base-content/40">
                        {{ nodeCount(sys.topology, 'tank') }}T {{ nodeCount(sys.topology, 'valve') }}V
                      </span>
                    </div>
                  </div>
                </a>
              }
            }

            @if (site.systems.length === 0) {
              <div class="px-5 py-6 text-center text-base-content/30">
                <p class="text-xs">No systems yet</p>
              </div>
            }
          </div>

          <!-- Footer actions -->
          <div class="px-3 py-3 border-t border-base-300/30 flex flex-col gap-2">
            <button class="btn btn-sm btn-ghost w-full justify-start gap-2" (click)="onAddClick()">
              <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                <path stroke-linecap="round" stroke-linejoin="round" d="M12 4v16m8-8H4" />
              </svg>
              Add System
            </button>
            @if (workspace.dirty()) {
              <button class="btn btn-sm btn-primary w-full" (click)="save()">Save Site</button>
            }
            @if (workspace.stale()) {
              <button class="btn btn-sm btn-warning w-full" (click)="rebuild()">Rebuild</button>
            }
          </div>
        } @else {
          <div class="flex-1 flex items-center justify-center">
            <span class="loading loading-spinner loading-md"></span>
          </div>
        }
      </div>
    }

    <!-- Ear toggle (always visible, right edge of sidebar) -->
    <button
      class="w-[var(--sidebar-ear)] bg-base-100 border-r border-base-300/40 flex flex-col items-center gap-2 pt-4 cursor-pointer hover:bg-base-200/30 transition-colors"
      (click)="expanded.set(!expanded())"
      [title]="expanded() ? 'Collapse sidebar' : 'Expand sidebar'"
    >
      <svg
        xmlns="http://www.w3.org/2000/svg"
        class="h-4 w-4 text-base-content/40 transition-transform"
        [class.-scale-x-100]="expanded()"
        fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"
      >
        <path stroke-linecap="round" stroke-linejoin="round" d="M9 5l7 7-7 7" />
      </svg>
      @if (!expanded() && workspace.site(); as site) {
        <span class="text-[10px] font-semibold tracking-wider uppercase [writing-mode:vertical-lr] select-none nav-label-site">
          {{ site.friendly_name }}
        </span>
      }
    </button>

    <!-- Add system dialog -->
    @if (showAddSystem()) {
      <dialog class="modal modal-open" style="position: fixed;">
        <div class="modal-box max-w-md">
          <h3 class="font-bold text-lg mb-4">Add System</h3>
          @if (availableConfigs().length === 0) {
            <p class="text-sm text-base-content/40 py-6 text-center">No available configs.</p>
          } @else {
            <div class="space-y-1 max-h-60 overflow-auto">
              @for (entry of availableConfigs(); track entry.name) {
                <button
                  class="btn btn-ghost btn-sm w-full justify-start gap-3 font-normal"
                  (click)="addSystem(entry.name)"
                >
                  <span class="font-medium">{{ entry.friendlyName || entry.name }}</span>
                  <span class="text-xs text-base-content/40 font-mono">{{ entry.board }}</span>
                </button>
              }
            </div>
          }
          <div class="modal-action">
            <button class="btn btn-ghost" (click)="showAddSystem.set(false)">Cancel</button>
          </div>
        </div>
        <div class="modal-backdrop" (click)="showAddSystem.set(false)"></div>
      </dialog>
    }
  `,
})
export class NavSidebarComponent {
  protected workspace = inject(WorkspaceService);
  private libraryService = inject(LibraryService);
  private router = inject(Router);

  protected expanded = signal(true);
  protected showAddSystem = signal(false);
  protected availableConfigs = signal<Array<{ name: string; friendlyName: string; board: string }>>([]);

  protected getSystem(config: string) {
    return this.workspace.systems().get(config) ?? null;
  }

  protected isSystemActive(config: string): boolean {
    return this.router.url.includes(`/system/${config}`);
  }

  protected nodeCount(topology: { nodes?: Array<{ kind: string }> }, kind: string): number {
    return topology.nodes?.filter(n => n.kind === kind).length ?? 0;
  }

  protected async save() {
    await this.workspace.saveSite();
  }

  protected async rebuild() {
    await this.workspace.rebuild();
  }

  protected async addSystem(configName: string) {
    const offset = this.workspace.site()?.systems.length ?? 0;
    await this.workspace.addSystem(configName, { x: (offset % 3) * 600, y: Math.floor(offset / 3) * 500 });
    await this.refreshAvailableConfigs();
    this.showAddSystem.set(false);
  }

  async refreshAvailableConfigs() {
    await this.libraryService.refresh();
    const site = this.workspace.site();
    const inSite = new Set(site?.systems.map(s => s.config) ?? []);
    this.availableConfigs.set(
      this.libraryService.entries()
        .filter(e => !inSite.has(e.name))
        .map(e => ({ name: e.name, friendlyName: e.friendlyName, board: e.board }))
    );
  }

  protected onAddClick() {
    this.refreshAvailableConfigs();
    this.showAddSystem.set(true);
  }
}
