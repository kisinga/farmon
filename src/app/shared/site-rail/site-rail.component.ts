import { Component, inject, signal, computed } from '@angular/core';
import { Router } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { WorkspaceService } from '../../core/services/workspace.service';
import { ElectronService } from '../../core/services/electron.service';
import type { TemplateListEntry, BoardListEntry } from '../../core/models/electron-api';

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
              [value]="site.friendlyName"
              (keydown.enter)="saveName($event)"
              (keydown.escape)="editingName.set(false)"
              (blur)="saveName($event)"
            />
          } @else {
            <span
              class="text-sm font-semibold nav-label-site cursor-pointer hover:underline"
              title="Click to rename site"
              (click)="editingName.set(true)"
            >{{ site.friendlyName }}</span>
          }
          <div class="flex flex-wrap items-center gap-x-2 gap-y-0.5">
            <span class="text-xs text-base-content/50">{{ controllerCount() }} controller{{ controllerCount() !== 1 ? 's' : '' }}</span>
            <span class="text-[10px] text-base-content/30">·</span>
            @for (stat of siteStats(); track stat.label) {
              <span class="text-xs text-base-content/40">{{ stat.count }} {{ stat.label }}</span>
            }
          </div>
        }
      </div>

      <!-- Actions -->
      <div class="flex items-center gap-2">
        <button class="btn btn-sm btn-ghost gap-1.5" (click)="onAddClick()">
          <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
            <path stroke-linecap="round" stroke-linejoin="round" d="M12 4v16m8-8H4" />
          </svg>
          Add Controller
        </button>
        <button class="btn btn-sm btn-ghost gap-1.5" (click)="goToDeploy()">
          <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
            <path stroke-linecap="round" stroke-linejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
          </svg>
          Deploy
        </button>
        <span class="text-[10px] text-base-content/30" [class.text-success]="!workspace.dirty()" [class.text-warning]="workspace.dirty()">
          {{ workspace.dirty() ? 'Saving…' : 'Saved' }}
        </span>
      </div>
    </div>

    <!-- Add controller dialog -->
    @if (showAddSystem()) {
      <dialog class="modal modal-open" style="position: fixed;">
        <div class="modal-box max-w-md">
          <h3 class="font-bold text-lg mb-4">Add Controller</h3>

          <!-- Name (always required) -->
          <div class="mb-4">
            <label class="label"><span class="label-text">Controller Name</span></label>
            <input
              class="input input-sm input-bordered w-full"
              [ngModel]="controllerName()"
              (ngModelChange)="controllerName.set($event)"
              placeholder="e.g. Pump Controller"
            />
          </div>

          <!-- Tabs -->
          <div class="tabs tabs-boxed mb-4">
            <button class="tab" [class.tab-active]="addMode() === 'template'" (click)="addMode.set('template')">From Template</button>
            <button class="tab" [class.tab-active]="addMode() === 'blank'" (click)="addMode.set('blank')">Blank</button>
          </div>

          @if (addMode() === 'template') {
            @if (templates().length === 0) {
              <p class="text-sm text-base-content/40 py-6 text-center">No templates available.</p>
            } @else {
              <p class="text-xs text-base-content/40 mb-2">Pick a template to pre-fill the topology.</p>
              <div class="space-y-1 max-h-60 overflow-auto">
                @for (entry of templates(); track entry.name) {
                  <button
                    class="btn btn-ghost btn-sm w-full justify-start gap-3 font-normal"
                    [class.btn-active]="selectedTemplate() === entry.name"
                    [disabled]="adding()"
                    (click)="selectedTemplate.set(entry.name)"
                  >
                    <span class="font-medium">{{ entry.friendlyName || entry.name }}</span>
                    <span class="text-xs text-base-content/40 font-mono">{{ entry.board }}</span>
                  </button>
                }
              </div>
            }
          }

          @if (addMode() === 'blank') {
            <div class="space-y-3">
              <div>
                <label class="label"><span class="label-text">Board</span></label>
                <select
                  class="select select-sm select-bordered w-full"
                  [ngModel]="selectedBoard()"
                  (ngModelChange)="selectedBoard.set($event)"
                >
                  <option value="">-- select board --</option>
                  @for (b of boards(); track b.model) {
                    <option [value]="b.model">{{ b.label }} ({{ b.model }})</option>
                  }
                </select>
              </div>
            </div>
          }

          <div class="modal-action">
            <button class="btn btn-ghost" (click)="showAddSystem.set(false)">Cancel</button>
            <button
              class="btn btn-primary"
              [disabled]="!canCreate() || adding()"
              (click)="onCreate()"
            >
              Create
            </button>
          </div>
        </div>
        <div class="modal-backdrop" (click)="showAddSystem.set(false)"></div>
      </dialog>
    }
  `,
})
export class SiteRailComponent {
  protected workspace = inject(WorkspaceService);
  private electron = inject(ElectronService);
  private router = inject(Router);

  protected showAddSystem = signal(false);
  protected editingName = signal(false);
  protected adding = signal(false);
  protected templates = signal<TemplateListEntry[]>([]);
  protected boards = signal<BoardListEntry[]>([]);
  protected addMode = signal<'template' | 'blank'>('template');
  protected controllerName = signal('');
  protected selectedTemplate = signal('');
  protected selectedBoard = signal('');

  protected controllerCount = computed(() => this.workspace.siteTopology()?.controllers.length ?? 0);

  protected canCreate = computed(() => {
    const name = this.controllerName().trim();
    if (!name) return false;
    if (this.addMode() === 'template') return !!this.selectedTemplate();
    return !!this.selectedBoard();
  });

  protected nodeCounts = computed(() => {
    const counts: Record<string, number> = {};
    for (const node of this.workspace.siteTopology()?.nodes ?? []) {
      const kind = node.kind;
      if (kind) counts[kind] = (counts[kind] ?? 0) + 1;
    }
    return counts;
  });

  protected siteStats = computed(() => {
    const c = this.nodeCounts();
    const show: [string, string][] = [
      ['tank', 'tanks'],
      ['water_source', 'sources'],
      ['pump', 'pumps'],
      ['endpoint', 'endpoints'],
    ];
    const stats: Array<{ label: string; count: number }> = [];
    for (const [kind, label] of show) {
      if (c[kind]) stats.push({ label, count: c[kind] });
    }
    return stats;
  });

  protected async onCreate() {
    const name = this.controllerName().trim();
    if (!name || !this.canCreate()) return;

    this.adding.set(true);
    try {
      let controllerId: string;
      if (this.addMode() === 'template') {
        controllerId = await this.workspace.addControllerFromTemplate(this.selectedTemplate(), name);
      } else {
        controllerId = await this.workspace.addBlankController(name, this.selectedBoard());
      }

      this.showAddSystem.set(false);
      this.controllerName.set('');
      this.selectedTemplate.set('');
      this.selectedBoard.set('');

      const siteId = this.workspace.site()?.id;
      if (siteId) {
        this.router.navigate(['/site', siteId, 'system', controllerId]);
      }
    } finally {
      this.adding.set(false);
    }
  }

  protected async onAddClick() {
    const [templates, boards] = await Promise.all([
      this.electron.templateList(),
      this.electron.boardList(),
    ]);
    this.templates.set(templates);
    this.boards.set(boards);
    this.showAddSystem.set(true);
    this.addMode.set('template');
    this.controllerName.set('');
    this.selectedTemplate.set('');
    this.selectedBoard.set('');
  }

  protected goToDeploy() {
    const siteId = this.workspace.site()?.id;
    if (siteId) this.router.navigate(['/site', siteId, 'deploy']);
  }

  protected saveName(event: Event) {
    const input = event.target as HTMLInputElement;
    const newName = input.value.trim();
    if (newName && newName !== this.workspace.site()?.friendlyName) {
      this.workspace.updateSiteName(newName);
    }
    this.editingName.set(false);
  }
}
