import { Component, inject, signal } from '@angular/core';
import { WorkspaceService } from '../../core/services/workspace.service';
import { LibraryService } from '../../core/services/library.service';

@Component({
  selector: 'app-site-rail',
  standalone: true,
  host: { class: 'shrink-0' },
  template: `
    <div class="h-[var(--pipeline-rail-h)] bg-base-100 border-t border-base-300/30 px-6 flex items-center justify-between">
      <!-- Site info -->
      <div class="flex items-center gap-4">
        @if (workspace.site(); as site) {
          <span class="text-sm font-semibold nav-label-site">{{ site.friendly_name }}</span>
          <span class="text-xs text-base-content/50">
            {{ site.systems.length }} system{{ site.systems.length !== 1 ? 's' : '' }}
          </span>
          <span class="text-xs text-base-content/50">
            {{ site.links.length }} link{{ site.links.length !== 1 ? 's' : '' }}
          </span>
        }
      </div>

      <!-- Actions -->
      <div class="flex items-center gap-2">
        <button class="btn btn-sm btn-ghost gap-1.5" (click)="onAddClick()">
          <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
            <path stroke-linecap="round" stroke-linejoin="round" d="M12 4v16m8-8H4" />
          </svg>
          Add System
        </button>
        @if (workspace.dirty()) {
          <button class="btn btn-sm btn-primary" (click)="saveSite()">Save Site</button>
        }
        @if (workspace.stale()) {
          <button class="btn btn-sm btn-warning" (click)="rebuild()">Rebuild</button>
        }
      </div>
    </div>

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
export class SiteRailComponent {
  protected workspace = inject(WorkspaceService);
  private libraryService = inject(LibraryService);

  protected showAddSystem = signal(false);
  protected availableConfigs = signal<Array<{ name: string; friendlyName: string; board: string }>>([]);

  protected async saveSite() {
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

  protected async onAddClick() {
    await this.refreshAvailableConfigs();
    this.showAddSystem.set(true);
  }

  private async refreshAvailableConfigs() {
    await this.libraryService.refresh();
    const site = this.workspace.site();
    const inSite = new Set(site?.systems.map(s => s.config) ?? []);
    this.availableConfigs.set(
      this.libraryService.entries()
        .filter(e => !inSite.has(e.name))
        .map(e => ({ name: e.name, friendlyName: e.friendlyName, board: e.board }))
    );
  }
}
