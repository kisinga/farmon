import { Component, inject, OnInit, signal, computed } from '@angular/core';
import { Router } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { LibraryService } from '../../core/services/library.service';
import { BoardService } from '../../core/services/board.service';
import { ElectronService } from '../../core/services/electron.service';

@Component({
  selector: 'app-library',
  standalone: true,
  imports: [FormsModule],
  template: `
    <div class="h-full flex flex-col">
      <!-- Page header -->
      <div class="px-8 pt-6 pb-4 bg-base-100 border-b border-base-300/30">
        <div class="flex items-center justify-between">
          <div>
            <h1 class="text-2xl font-bold tracking-tight">System Library</h1>
            <p class="text-sm text-base-content/40 mt-0.5">
              {{ library.entries().length }} configuration{{ library.entries().length !== 1 ? 's' : '' }}
            </p>
          </div>
          <div class="flex items-center gap-2">
            <!-- Import dropdown -->
            <div class="dropdown dropdown-end">
              <div tabindex="0" role="button" class="btn btn-ghost btn-sm gap-1.5 text-base-content/60">
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
            <label class="input input-bordered input-sm flex items-center gap-2 max-w-sm bg-base-200/50 border-base-300/40 focus-within:border-primary/50">
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
            <h2 class="text-lg font-semibold text-base-content/50 mb-1">No configurations yet</h2>
            <p class="text-sm text-base-content/30 mb-6 max-w-xs text-center">
              Create your first water system or import an existing configuration file.
            </p>
            <div class="flex gap-3">
              <button class="btn btn-primary btn-sm" (click)="openCreateDialog()">Create System</button>
              <button class="btn btn-ghost btn-sm" (click)="importConfig()">Import Config</button>
            </div>
          </div>
        } @else if (filteredEntries().length === 0) {
          <div class="text-center py-20 text-base-content/30 text-sm">
            No configs matching "{{ searchQuery() }}"
          </div>
        } @else {
          <div class="grid gap-3">
            @for (entry of filteredEntries(); track entry.name) {
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
                    <p class="text-xs text-base-content/35 font-mono mt-0.5">{{ entry.deviceName }}</p>
                  </div>

                  <!-- Board badge -->
                  <div class="badge badge-sm bg-primary/8 text-primary/70 border-primary/15 font-medium">{{ entry.board }}</div>

                  <!-- Stats -->
                  <div class="flex gap-5 text-center">
                    <div>
                      <div class="text-sm font-bold tabular-nums">{{ entry.tanks }}</div>
                      <div class="text-[10px] text-base-content/30 uppercase tracking-wider">Tanks</div>
                    </div>
                    <div>
                      <div class="text-sm font-bold tabular-nums">{{ entry.valves }}</div>
                      <div class="text-[10px] text-base-content/30 uppercase tracking-wider">Valves</div>
                    </div>
                    <div>
                      <div class="text-sm font-bold tabular-nums">{{ entry.routes }}</div>
                      <div class="text-[10px] text-base-content/30 uppercase tracking-wider">Routes</div>
                    </div>
                  </div>

                  <!-- Actions -->
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

      <!-- Create Dialog -->
      @if (showCreateDialog()) {
        <dialog class="modal modal-open">
          <div class="modal-box max-w-md">
            <h3 class="text-lg font-bold">New System</h3>
            <p class="text-sm text-base-content/40 mt-1 mb-5">Configure a new water pump control system.</p>
            <div class="space-y-4">
              <label class="form-control">
                <div class="label pb-1"><span class="label-text text-xs font-medium">System Name</span></div>
                <input
                  type="text"
                  class="input input-bordered input-sm"
                  placeholder="e.g. My Pump Controller"
                  [ngModel]="dialogName()"
                  (ngModelChange)="dialogName.set($event)"
                  (keydown.enter)="confirmCreate()"
                  autofocus
                />
                @if (dialogName()) {
                  <div class="label pb-0">
                    <span class="label-text-alt text-base-content/30 font-mono text-[11px]">
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
                  <span class="label-text-alt text-base-content/30 text-[11px]">
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
            <h3 class="text-lg font-bold">Duplicate System</h3>
            <p class="text-sm text-base-content/40 mt-1 mb-5">Create a copy of "{{ duplicateSource() }}".</p>
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
            </label>
            <div class="modal-action mt-6">
              <button class="btn btn-ghost btn-sm" (click)="showDuplicateDialog.set(false)">Cancel</button>
              <button class="btn btn-primary btn-sm" (click)="confirmDuplicate()" [disabled]="!dialogName()">Duplicate</button>
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

  protected filteredEntries = computed(() => {
    const q = this.searchQuery().toLowerCase();
    if (!q) return this.library.entries();
    return this.library.entries().filter(
      (e) =>
        e.friendlyName.toLowerCase().includes(q) ||
        e.deviceName.toLowerCase().includes(q) ||
        e.board.toLowerCase().includes(q)
    );
  });

  protected toSlug(name: string): string {
    return name.toLowerCase().replace(/[^a-z0-9-]/g, '-');
  }

  protected showCreateDialog = signal(false);
  protected showDuplicateDialog = signal(false);
  protected dialogName = signal('');
  protected dialogBoard = signal('');
  protected duplicateSource = signal('');

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
    const slug = name.toLowerCase().replace(/[^a-z0-9-]/g, '-');
    this.showCreateDialog.set(false);
    this.dialogName.set('');
    this.dialogBoard.set('');
    await this.library.save(slug, {
      device: { name: slug, friendly_name: name, board },
      pump: { pin: 'GPIO42' },
      tanks: [],
      valves: [],
      flow_sensors: [],
      routes: [],
      timing: {},
    });
    this.router.navigate(['/editor', slug]);
  }

  startDuplicate(name: string, event: Event) {
    event.stopPropagation();
    this.duplicateSource.set(name);
    this.dialogName.set(`${name}-copy`);
    this.showDuplicateDialog.set(true);
  }

  async confirmDuplicate() {
    const newName = this.dialogName();
    if (!newName) return;
    this.showDuplicateDialog.set(false);
    this.dialogName.set('');
    await this.library.duplicate(this.duplicateSource(), newName);
  }

  async remove(name: string, event: Event) {
    event.stopPropagation();
    await this.library.remove(name);
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
}
