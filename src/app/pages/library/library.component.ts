import { Component, inject, OnInit, signal, computed } from '@angular/core';
import { Router } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { LibraryService } from '../../core/services/library.service';
import { BoardService } from '../../core/services/board.service';
import { ElectronService } from '../../core/services/electron.service';
import type { SystemTopology } from '../../core/models/topology.model';

@Component({
  selector: 'app-library',
  standalone: true,
  imports: [FormsModule],
  template: `
    <div class="min-h-full flex flex-col">
      <!-- Page header -->
      <div class="px-8 pt-6 pb-4 bg-base-100 border-b border-base-300/50 sticky top-0 z-10">
        <div class="flex items-center justify-between">
          <div>
            <h1 class="text-xl font-bold tracking-tight">System Library</h1>
            <p class="text-sm text-base-content/60 mt-0.5">
              {{ library.userConfigs().length }} system{{ library.userConfigs().length !== 1 ? 's' : '' }},
              {{ library.templates().length }} template{{ library.templates().length !== 1 ? 's' : '' }}
            </p>
          </div>
          <div class="flex items-center gap-2">
            <!-- Import dropdown -->
            <div class="dropdown dropdown-end">
              <div tabindex="0" role="button" class="btn btn-ghost btn-sm gap-1.5 text-base-content/70">
                <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                </svg>
                Import
              </div>
              <ul tabindex="0" class="dropdown-content menu bg-base-100 rounded-lg z-10 w-48 p-1.5 shadow-xl border border-base-300/50">
                <li><a class="text-sm rounded-md" (click)="importConfig()">System Config (.yaml)</a></li>
                <li><a class="text-sm rounded-md" (click)="importBoard()">Board Definition</a></li>
              </ul>
            </div>
            <button class="btn btn-primary btn-sm gap-1.5" (click)="openCreateDialog()">
              <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                <path fill-rule="evenodd" d="M10 3a1 1 0 011 1v5h5a1 1 0 110 2h-5v5a1 1 0 11-2 0v-5H4a1 1 0 110-2h5V4a1 1 0 011-1z" clip-rule="evenodd" />
              </svg>
              New System
            </button>
          </div>
        </div>

        <!-- Search bar -->
        @if (library.entries().length > 0) {
          <div class="mt-4">
            <label class="input input-bordered input-sm flex items-center gap-2 max-w-sm bg-base-200/50 border-base-300/60 focus-within:border-primary/50">
              <svg xmlns="http://www.w3.org/2000/svg" class="h-3.5 w-3.5 opacity-40" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                <path stroke-linecap="round" stroke-linejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
              <input
                type="text"
                class="grow"
                placeholder="Search configs..."
                [ngModel]="searchQuery()"
                (ngModelChange)="searchQuery.set($event)"
              />
            </label>
          </div>
        }
      </div>

      <!-- Alerts -->
      <div class="px-8">
        @if (errorMessage()) {
          <div class="alert alert-error mt-4 py-2 text-sm">
            <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <span>{{ errorMessage() }}</span>
            <button class="btn btn-ghost btn-xs" (click)="errorMessage.set('')">Dismiss</button>
          </div>
        }
        @if (successMessage()) {
          <div class="alert alert-success mt-4 py-2 text-sm">
            <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <span>{{ successMessage() }}</span>
            <button class="btn btn-ghost btn-xs" (click)="successMessage.set('')">Dismiss</button>
          </div>
        }
      </div>

      <!-- Content -->
      <div class="flex-1 overflow-auto px-8 py-6">
        @if (library.loading()) {
          <div class="flex justify-center py-20">
            <span class="loading loading-spinner loading-lg text-primary/50"></span>
          </div>
        } @else if (library.entries().length === 0) {
          <!-- Empty state -->
          <div class="flex flex-col items-center justify-center py-20">
            <div class="w-16 h-16 rounded-2xl bg-base-300/30 flex items-center justify-center mb-5">
              <svg xmlns="http://www.w3.org/2000/svg" class="h-8 w-8 text-base-content/20" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
                <path stroke-linecap="round" stroke-linejoin="round" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
              </svg>
            </div>
            <h2 class="text-lg font-semibold text-base-content/60 mb-1">No configurations yet</h2>
            <p class="text-sm text-base-content/50 mb-6 max-w-xs text-center">
              Create your first water system or import an existing configuration file.
            </p>
            <div class="flex gap-3">
              <button class="btn btn-primary btn-sm" (click)="openCreateDialog()">Create System</button>
              <button class="btn btn-ghost btn-sm" (click)="importConfig()">Import Config</button>
            </div>
          </div>
        } @else {
          <!-- My Systems section -->
          @if (filteredUserConfigs().length > 0 || !searchQuery()) {
            <div class="mb-8">
              <h2 class="text-xs font-semibold text-base-content/50 uppercase tracking-wider mb-3">My Systems</h2>
              @if (filteredUserConfigs().length === 0) {
                <div class="text-sm text-base-content/40 py-4 pl-1">
                  @if (searchQuery()) {
                    No systems matching "{{ searchQuery() }}"
                  } @else {
                    No systems yet. Create one or use a template below.
                  }
                </div>
              } @else {
                <div class="grid gap-3">
                  @for (entry of filteredUserConfigs(); track entry.name) {
                    <div
                      class="group bg-base-100 rounded-xl border border-base-300/40 hover:border-primary/30 hover:shadow-md transition-all cursor-pointer"
                      (click)="open(entry.name)"
                    >
                      <div class="flex items-center gap-5 px-5 py-4">
                        <!-- Icon -->
                        <div class="w-10 h-10 rounded-lg bg-primary/8 flex items-center justify-center shrink-0 group-hover:bg-primary/15 transition-colors">
                          <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 text-primary/60" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
                            <path stroke-linecap="round" stroke-linejoin="round" d="M9 3v2m6-2v2M9 19v2m6-2v2M5 9H3m2 6H3m18-6h-2m2 6h-2M7 19h10a2 2 0 002-2V7a2 2 0 00-2-2H7a2 2 0 00-2 2v10a2 2 0 002 2zM9 9h6v6H9V9z" />
                          </svg>
                        </div>

                        <!-- Name & ID -->
                        <div class="flex-1 min-w-0">
                          <h3 class="font-semibold text-sm truncate group-hover:text-primary transition-colors">{{ entry.friendlyName }}</h3>
                          <p class="text-xs text-base-content/50 font-mono mt-0.5">{{ entry.deviceName }}</p>
                        </div>

                        <!-- Board badge -->
                        <div class="badge badge-sm bg-primary/8 text-primary/70 border-primary/15 font-medium">{{ entry.board }}</div>

                        <!-- Stats -->
                        <div class="flex gap-5 text-center">
                          <div>
                            <div class="text-sm font-bold tabular-nums">{{ entry.tanks }}</div>
                            <div class="text-[10px] text-base-content/50 uppercase tracking-wider">Tanks</div>
                          </div>
                          <div>
                            <div class="text-sm font-bold tabular-nums">{{ entry.valves }}</div>
                            <div class="text-[10px] text-base-content/50 uppercase tracking-wider">Valves</div>
                          </div>
                          <div>
                            <div class="text-sm font-bold tabular-nums">{{ entry.routes }}</div>
                            <div class="text-[10px] text-base-content/50 uppercase tracking-wider">Routes</div>
                          </div>
                        </div>

                        <!-- Actions (user configs: export, duplicate, delete) -->
                        <div class="flex gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                          <button class="btn btn-ghost btn-xs btn-square" title="Export" (click)="exportConfig(entry.name, $event)">
                            <svg xmlns="http://www.w3.org/2000/svg" class="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                              <path stroke-linecap="round" stroke-linejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                            </svg>
                          </button>
                          <button class="btn btn-ghost btn-xs btn-square" title="Duplicate" (click)="startDuplicate(entry.name, $event)">
                            <svg xmlns="http://www.w3.org/2000/svg" class="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                              <path stroke-linecap="round" stroke-linejoin="round" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                            </svg>
                          </button>
                          <button class="btn btn-ghost btn-xs btn-square text-error/60 hover:text-error" title="Delete" (click)="remove(entry.name, $event)">
                            <svg xmlns="http://www.w3.org/2000/svg" class="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                              <path stroke-linecap="round" stroke-linejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                            </svg>
                          </button>
                        </div>
                      </div>
                    </div>
                  }
                </div>
              }
            </div>
          }

          <!-- Templates section -->
          @if (filteredTemplates().length > 0) {
            <div>
              <h2 class="text-xs font-semibold text-base-content/50 uppercase tracking-wider mb-3">Templates</h2>
              <p class="text-xs text-base-content/40 mb-3">Read-only examples. Use a template to create an editable copy.</p>
              <div class="grid gap-3">
                @for (entry of filteredTemplates(); track entry.name) {
                  <div
                    class="group bg-base-100 rounded-xl border border-base-300/40 border-dashed hover:border-primary/30 hover:shadow-md transition-all cursor-pointer"
                    (click)="useTemplate(entry.name, $event)"
                  >
                    <div class="flex items-center gap-5 px-5 py-4">
                      <!-- Icon (template variant) -->
                      <div class="w-10 h-10 rounded-lg bg-base-300/30 flex items-center justify-center shrink-0 group-hover:bg-primary/10 transition-colors">
                        <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 text-base-content/40" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
                          <path stroke-linecap="round" stroke-linejoin="round" d="M8 7v8a2 2 0 002 2h6M8 7V5a2 2 0 012-2h4.586a1 1 0 01.707.293l4.414 4.414a1 1 0 01.293.707V15a2 2 0 01-2 2h-2M8 7H6a2 2 0 00-2 2v10a2 2 0 002 2h8a2 2 0 002-2v-2" />
                        </svg>
                      </div>

                      <!-- Name & ID -->
                      <div class="flex-1 min-w-0">
                        <div class="flex items-center gap-2">
                          <h3 class="font-semibold text-sm truncate group-hover:text-primary transition-colors">{{ entry.friendlyName }}</h3>
                          <span class="badge badge-xs badge-ghost text-base-content/40 border-base-300/60">Template</span>
                        </div>
                        <p class="text-xs text-base-content/50 font-mono mt-0.5">{{ entry.deviceName }}</p>
                      </div>

                      <!-- Board badge -->
                      <div class="badge badge-sm bg-base-300/30 text-base-content/50 border-base-300/40 font-medium">{{ entry.board }}</div>

                      <!-- Stats -->
                      <div class="flex gap-5 text-center">
                        <div>
                          <div class="text-sm font-bold tabular-nums text-base-content/60">{{ entry.tanks }}</div>
                          <div class="text-[10px] text-base-content/40 uppercase tracking-wider">Tanks</div>
                        </div>
                        <div>
                          <div class="text-sm font-bold tabular-nums text-base-content/60">{{ entry.valves }}</div>
                          <div class="text-[10px] text-base-content/40 uppercase tracking-wider">Valves</div>
                        </div>
                        <div>
                          <div class="text-sm font-bold tabular-nums text-base-content/60">{{ entry.routes }}</div>
                          <div class="text-[10px] text-base-content/40 uppercase tracking-wider">Routes</div>
                        </div>
                      </div>

                      <!-- Actions (templates: use, export only) -->
                      <div class="flex gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button class="btn btn-ghost btn-xs btn-square" title="Export" (click)="exportConfig(entry.name, $event)">
                          <svg xmlns="http://www.w3.org/2000/svg" class="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                            <path stroke-linecap="round" stroke-linejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                          </svg>
                        </button>
                        <button class="btn btn-primary btn-xs gap-1" title="Use Template" (click)="useTemplate(entry.name, $event)">
                          <svg xmlns="http://www.w3.org/2000/svg" class="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                            <path stroke-linecap="round" stroke-linejoin="round" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                          </svg>
                          Use
                        </button>
                      </div>
                    </div>
                  </div>
                }
              </div>
            </div>
          }

          <!-- No search results -->
          @if (filteredUserConfigs().length === 0 && filteredTemplates().length === 0 && searchQuery()) {
            <div class="text-center py-20 text-base-content/50 text-sm">
              No configs matching "{{ searchQuery() }}"
            </div>
          }
        }
      </div>

      <!-- Create Dialog -->
      @if (showCreateDialog()) {
        <dialog class="modal modal-open">
          <div class="modal-box max-w-md">
            <h3 class="text-lg font-bold">New System</h3>
            <p class="text-sm text-base-content/60 mt-1 mb-5">Configure a new water orchestration system.</p>
            <div class="space-y-4">
              <label class="form-control">
                <div class="label pb-1"><span class="label-text text-xs font-medium">System Name</span></div>
                <input
                  type="text"
                  class="input input-bordered input-sm"
                  placeholder="e.g. My Farm System"
                  [ngModel]="dialogName()"
                  (ngModelChange)="dialogName.set($event)"
                  (keydown.enter)="confirmCreate()"
                  autofocus
                />
                @if (dialogName()) {
                  <div class="label pb-0">
                    <span class="label-text-alt text-base-content/50 font-mono text-[11px]">
                      {{ toSlug(dialogName()) }}
                    </span>
                  </div>
                }
              </label>
              <label class="form-control">
                <div class="label pb-1"><span class="label-text text-xs font-medium">Target Board</span></div>
                <select
                  class="select select-bordered select-sm"
                  [ngModel]="dialogBoard()"
                  (ngModelChange)="dialogBoard.set($event)"
                >
                  <option value="" disabled>Select a board...</option>
                  @for (b of boardService.boards(); track b.id) {
                    <option [value]="b.id">{{ b.label }}</option>
                  }
                </select>
                <div class="label pb-0">
                  <span class="label-text-alt text-base-content/50 text-[11px]">
                    Determines available pins and peripherals.
                  </span>
                </div>
              </label>
            </div>
            <div class="modal-action mt-6">
              <button class="btn btn-ghost btn-sm" (click)="showCreateDialog.set(false)">Cancel</button>
              <button
                class="btn btn-primary btn-sm"
                (click)="confirmCreate()"
                [disabled]="!dialogName() || !dialogBoard()"
              >Create</button>
            </div>
          </div>
          <div class="modal-backdrop bg-black/30" (click)="showCreateDialog.set(false)"></div>
        </dialog>
      }

      <!-- Duplicate Dialog -->
      @if (showDuplicateDialog()) {
        <dialog class="modal modal-open">
          <div class="modal-box max-w-sm">
            <h3 class="text-lg font-bold">{{ duplicateIsTemplate() ? 'New From Template' : 'Duplicate System' }}</h3>
            <p class="text-sm text-base-content/60 mt-1 mb-5">
              {{ duplicateIsTemplate() ? 'Create an editable copy of' : 'Create a copy of' }} "{{ duplicateSource() }}".
            </p>
            <label class="form-control">
              <div class="label pb-1"><span class="label-text text-xs font-medium">New Name</span></div>
              <input
                type="text"
                class="input input-bordered input-sm"
                [ngModel]="dialogName()"
                (ngModelChange)="dialogName.set($event)"
                (keydown.enter)="confirmDuplicate()"
                autofocus
              />
              @if (dialogName()) {
                <div class="label pb-0">
                  <span class="label-text-alt text-base-content/50 font-mono text-[11px]">
                    {{ toSlug(dialogName()) }}
                  </span>
                </div>
              }
            </label>
            <div class="modal-action mt-6">
              <button class="btn btn-ghost btn-sm" (click)="showDuplicateDialog.set(false)">Cancel</button>
              <button class="btn btn-primary btn-sm" (click)="confirmDuplicate()" [disabled]="!dialogName()">
                {{ duplicateIsTemplate() ? 'Create' : 'Duplicate' }}
              </button>
            </div>
          </div>
          <div class="modal-backdrop bg-black/30" (click)="showDuplicateDialog.set(false)"></div>
        </dialog>
      }
    </div>
  `,
})
export class LibraryComponent implements OnInit {
  protected library = inject(LibraryService);
  protected boardService = inject(BoardService);
  private electron = inject(ElectronService);
  private router = inject(Router);

  protected searchQuery = signal('');
  protected errorMessage = signal('');
  protected successMessage = signal('');

  protected filteredUserConfigs = computed(() => {
    const q = this.searchQuery().toLowerCase();
    const entries = this.library.userConfigs();
    if (!q) return entries;
    return entries.filter(e => this.matchesSearch(e, q));
  });

  protected filteredTemplates = computed(() => {
    const q = this.searchQuery().toLowerCase();
    const entries = this.library.templates();
    if (!q) return entries;
    return entries.filter(e => this.matchesSearch(e, q));
  });

  protected toSlug(name: string): string {
    return name.toLowerCase().replace(/[^a-z0-9-]/g, '-');
  }

  protected showCreateDialog = signal(false);
  protected showDuplicateDialog = signal(false);
  protected dialogName = signal('');
  protected dialogBoard = signal('');
  protected duplicateSource = signal('');
  protected duplicateIsTemplate = signal(false);

  ngOnInit() {
    this.library.refresh();
    this.boardService.refresh();
  }

  open(name: string) {
    this.router.navigate(['/editor', name]);
  }

  openCreateDialog() {
    this.dialogName.set('');
    this.dialogBoard.set('');
    this.showCreateDialog.set(true);
  }

  async confirmCreate() {
    const name = this.dialogName();
    const board = this.dialogBoard();
    if (!name || !board) return;
    const slug = this.toSlug(name);
    this.showCreateDialog.set(false);
    this.dialogName.set('');
    this.dialogBoard.set('');

    try {
      const topology: SystemTopology = {
        schema: 5,
        device: { name: slug, friendly_name: name, board },
        nodes: [
          {
            kind: 'pump',
            id: 'pump',
            pin: 'GPIO42',
            ports: [
              { id: 'inlet', label: 'In', direction: 'inlet' },
              { id: 'outlet', label: 'Out', direction: 'outlet' },
            ],
            position: { x: 300, y: 200 },
          },
        ],
        pipes: [],
        route_overrides: {},
        timing: {
          valve_travel_time: '15s',
          flow_watchdog_seconds: 30,
          flow_confirm_seconds: 15,
          api_watchdog_seconds: 300,
          update_interval: '5s',
        },
      };
      await this.library.save(slug, topology);
      this.router.navigate(['/editor', slug]);
    } catch (err: any) {
      this.errorMessage.set(err?.message ?? 'Failed to create system');
    }
  }

  /** Open the duplicate dialog — works for both templates and user configs. */
  startDuplicate(name: string, event: Event) {
    event.stopPropagation();
    const entry = this.library.entries().find(e => e.name === name);
    this.duplicateSource.set(name);
    this.duplicateIsTemplate.set(entry?.library ?? false);
    this.dialogName.set(`${name}-copy`);
    this.showDuplicateDialog.set(true);
  }

  /** Templates: clicking the row opens the duplicate dialog. */
  useTemplate(name: string, event: Event) {
    event.stopPropagation();
    this.duplicateSource.set(name);
    this.duplicateIsTemplate.set(true);
    this.dialogName.set(`${name}-copy`);
    this.showDuplicateDialog.set(true);
  }

  async confirmDuplicate() {
    const newName = this.dialogName();
    if (!newName) return;
    const slug = this.toSlug(newName);
    this.showDuplicateDialog.set(false);
    this.dialogName.set('');

    try {
      const savedName = await this.library.duplicate(this.duplicateSource(), slug);
      this.router.navigate(['/editor', savedName]);
    } catch (err: any) {
      this.errorMessage.set(err?.message ?? 'Failed to duplicate');
    }
  }

  async remove(name: string, event: Event) {
    event.stopPropagation();
    try {
      await this.library.remove(name);
    } catch (err: any) {
      this.errorMessage.set(err?.message ?? 'Failed to delete');
    }
  }

  async importConfig() {
    try {
      const filePath = await this.electron.pickFile({
        title: 'Import System Config',
        filters: [{ name: 'YAML', extensions: ['yaml', 'yml'] }],
      });
      if (!filePath) return;
      const configName = await this.electron.importConfig(filePath);
      await this.library.refresh();
      this.successMessage.set(`Imported config "${configName}"`);
      this.router.navigate(['/editor', configName]);
    } catch (err: any) {
      this.errorMessage.set(err?.message ?? 'Failed to import config');
    }
  }

  async importBoard() {
    try {
      const dirPath = await this.electron.pickDirectory({
        title: 'Import Board Definition',
      });
      if (!dirPath) return;
      const model = await this.electron.importBoard(dirPath);
      await this.boardService.refresh();
      this.successMessage.set(`Imported board "${model}"`);
    } catch (err: any) {
      this.errorMessage.set(err?.message ?? 'Failed to import board');
    }
  }

  async exportConfig(name: string, event: Event) {
    event.stopPropagation();
    try {
      const destPath = await this.electron.saveFile({
        title: 'Export System Config',
        defaultPath: `${name}.yaml`,
        filters: [{ name: 'YAML', extensions: ['yaml', 'yml'] }],
      });
      if (!destPath) return;
      await this.electron.exportConfig(name, destPath);
      this.successMessage.set(`Exported "${name}" successfully`);
    } catch (err: any) {
      this.errorMessage.set(err?.message ?? 'Failed to export config');
    }
  }

  private matchesSearch(e: { friendlyName: string; deviceName: string; board: string }, q: string): boolean {
    return (
      e.friendlyName.toLowerCase().includes(q) ||
      e.deviceName.toLowerCase().includes(q) ||
      e.board.toLowerCase().includes(q)
    );
  }
}
