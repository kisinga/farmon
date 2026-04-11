import { Component, inject, signal, computed } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { WorkspaceService } from '../../core/services/workspace.service';
import { LibraryService } from '../../core/services/library.service';

@Component({
  selector: 'app-site-rail',
  standalone: true,
  imports: [FormsModule],
  host: { class: 'shrink-0' },
  template: `
    <div class="h-[var(--pipeline-rail-h)] bg-base-100 border-t border-base-300/30 px-6 flex items-center justify-between">
      <!-- Site info -->
      <div class="flex items-center gap-4">
        @if (workspace.site(); as site) {
          @if (editingName()) {
            <input
              class="input input-sm input-bordered font-semibold text-sm w-48"
              [value]="site.friendly_name"
              (keydown.enter)="saveName($event)"
              (keydown.escape)="editingName.set(false)"
              (blur)="saveName($event)"
            />
          } @else {
            <span
              class="text-sm font-semibold nav-label-site cursor-pointer hover:underline"
              title="Click to rename site"
              (click)="editingName.set(true)"
            >{{ site.friendly_name }}</span>
          }
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

          <!-- Tab bar -->
          <div role="tablist" class="tabs tabs-bordered mb-3">
            <button role="tab" class="tab" [class.tab-active]="addTab() === 'templates'" (click)="addTab.set('templates')">Templates</button>
            <button role="tab" class="tab" [class.tab-active]="addTab() === 'systems'" (click)="addTab.set('systems')">Existing Systems</button>
          </div>

          <!-- Templates tab -->
          @if (addTab() === 'templates') {
            @if (templateConfigs().length === 0) {
              <p class="text-sm text-base-content/40 py-6 text-center">No templates available.</p>
            } @else {
              <p class="text-xs text-base-content/40 mb-2">Create a site-scoped system from a template.</p>
              <div class="space-y-1 max-h-60 overflow-auto">
                @for (entry of templateConfigs(); track entry.name) {
                  <button
                    class="btn btn-ghost btn-sm w-full justify-start gap-3 font-normal"
                    (click)="addFromTemplate(entry.name)"
                  >
                    <span class="font-medium">{{ entry.friendlyName || entry.name }}</span>
                    <span class="text-xs text-base-content/40 font-mono">{{ entry.board }}</span>
                  </button>
                }
              </div>
            }
          }

          <!-- Existing systems tab -->
          @if (addTab() === 'systems') {
            @if (systemConfigs().length === 0) {
              <p class="text-sm text-base-content/40 py-6 text-center">No existing systems found.</p>
            } @else {
              <input
                type="text"
                class="input input-sm input-bordered w-full mb-2"
                placeholder="Search systems..."
                [ngModel]="systemSearch()"
                (ngModelChange)="systemSearch.set($event)"
              />
              <div class="space-y-1 max-h-60 overflow-auto">
                @for (entry of filteredSystemConfigs(); track entry.name) {
                  @if (entry.inSite) {
                    <div class="flex items-center gap-2 px-3 py-1.5 rounded-lg">
                      <div class="flex-1 min-w-0">
                        <span class="font-medium text-sm text-base-content/40">{{ entry.friendlyName || entry.name }}</span>
                        <span class="text-xs text-base-content/30 font-mono ml-2">{{ entry.board }}</span>
                        <span class="badge badge-ghost badge-xs ml-2">in site</span>
                      </div>
                      <button
                        class="btn btn-ghost btn-xs text-primary"
                        title="Create a site-scoped copy"
                        (click)="addSiteScopedCopy(entry.name)"
                      >+ Copy</button>
                    </div>
                  } @else {
                    <button
                      class="btn btn-ghost btn-sm w-full justify-start gap-3 font-normal"
                      (click)="addSystemReference(entry.name)"
                    >
                      <span class="font-medium">{{ entry.friendlyName || entry.name }}</span>
                      <span class="text-xs text-base-content/40 font-mono">{{ entry.board }}</span>
                    </button>
                  }
                }
                @if (filteredSystemConfigs().length === 0) {
                  <p class="text-sm text-base-content/40 py-4 text-center">No matches.</p>
                }
              </div>
            }
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
  protected editingName = signal(false);
  protected addTab = signal<'templates' | 'systems'>('templates');
  protected systemSearch = signal('');

  // --- Config lists (populated when dialog opens) ---
  protected templateConfigs = signal<Array<{ name: string; friendlyName: string; board: string }>>([]);
  protected systemConfigs = signal<Array<{ name: string; friendlyName: string; board: string; inSite: boolean }>>([]);

  protected filteredSystemConfigs = computed(() => {
    const q = this.systemSearch().toLowerCase().trim();
    const all = this.systemConfigs();
    if (!q) return all;
    return all.filter(e =>
      e.name.toLowerCase().includes(q) ||
      e.friendlyName.toLowerCase().includes(q) ||
      e.board.toLowerCase().includes(q)
    );
  });

  protected async saveSite() {
    await this.workspace.saveSite();
  }

  protected async rebuild() {
    await this.workspace.rebuild();
  }

  /** Add from a template — always creates a site-scoped copy (templates are read-only). */
  protected async addFromTemplate(templateName: string) {
    const allOnDisk = new Set(this.libraryService.entries().map(e => e.name));
    const inSite = new Set(this.workspace.site()?.systems.map(s => s.config) ?? []);
    const allExisting = new Set([...inSite, ...allOnDisk]);
    const copyName = this.nextInstanceName(templateName, allExisting);
    const targetConfig = await this.libraryService.duplicate(templateName, copyName);

    const position = this.workspace.nextSystemPosition();
    await this.workspace.addSystem(targetConfig, position);
    this.showAddSystem.set(false);
  }

  /** Add an existing user config as a reference (not duplicated). */
  protected async addSystemReference(configName: string) {
    const position = this.workspace.nextSystemPosition();
    await this.workspace.addSystem(configName, position);
    this.showAddSystem.set(false);
  }

  /** Create a site-scoped copy of a config that's already in the site. */
  protected async addSiteScopedCopy(configName: string) {
    const inSite = new Set(this.workspace.site()?.systems.map(s => s.config) ?? []);
    const allOnDisk = new Set(this.libraryService.entries().map(e => e.name));
    const allExisting = new Set([...inSite, ...allOnDisk]);
    const copyName = this.nextInstanceName(configName, allExisting);
    const targetConfig = await this.libraryService.duplicate(configName, copyName);

    const position = this.workspace.nextSystemPosition();
    await this.workspace.addSystem(targetConfig, position);
    this.showAddSystem.set(false);
  }

  /** Generate a unique instance name using the same sequential pattern as node IDs. */
  private nextInstanceName(baseName: string, existing: Set<string>): string {
    const regex = new RegExp(`^${baseName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(\\d+)$`);
    let max = 1; // baseName itself counts as 1
    for (const name of existing) {
      if (name === baseName) continue;
      const match = name.match(regex);
      if (match) max = Math.max(max, parseInt(match[1]));
    }
    return `${baseName}${max + 1}`;
  }

  protected async onAddClick() {
    await this.refreshAvailableConfigs();
    this.addTab.set('templates');
    this.systemSearch.set('');
    this.showAddSystem.set(true);
  }

  private async refreshAvailableConfigs() {
    await this.libraryService.refresh();
    const inSite = new Set(this.workspace.site()?.systems.map(s => s.config) ?? []);

    this.templateConfigs.set(
      this.libraryService.templates()
        .map(e => ({ name: e.name, friendlyName: e.friendlyName, board: e.board }))
    );

    this.systemConfigs.set(
      this.libraryService.userConfigs()
        .map(e => ({ name: e.name, friendlyName: e.friendlyName, board: e.board, inSite: inSite.has(e.name) }))
    );
  }

  protected saveName(event: Event) {
    const input = event.target as HTMLInputElement;
    const newName = input.value.trim();
    if (newName && newName !== this.workspace.site()?.friendly_name) {
      this.workspace.updateSite(s => { s.friendly_name = newName; });
    }
    this.editingName.set(false);
  }
}
