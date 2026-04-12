import { Component, inject, signal } from '@angular/core';
import { WorkspaceService } from '../../core/services/workspace.service';
import { ElectronService } from '../../core/services/electron.service';
import type { TemplateListEntry } from '../../core/models/electron-api';

@Component({
  selector: 'app-site-rail',
  standalone: true,
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
          <span class="text-xs text-base-content/50">
            {{ workspace.systems().size }} controller{{ workspace.systems().size !== 1 ? 's' : '' }}
          </span>
          <span class="text-xs text-base-content/50">
            {{ workspace.links().length }} link{{ workspace.links().length !== 1 ? 's' : '' }}
          </span>
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
        @if (workspace.dirty()) {
          <button class="btn btn-sm btn-primary" (click)="saveSite()">Save Site</button>
        }
      </div>
    </div>

    <!-- Add system dialog (templates only) -->
    @if (showAddSystem()) {
      <dialog class="modal modal-open" style="position: fixed;">
        <div class="modal-box max-w-md">
          <h3 class="font-bold text-lg mb-4">Add Controller from Template</h3>

          @if (templates().length === 0) {
            <p class="text-sm text-base-content/40 py-6 text-center">No templates available.</p>
          } @else {
            <p class="text-xs text-base-content/40 mb-2">Create a controller from a template.</p>
            <div class="space-y-1 max-h-60 overflow-auto">
              @for (entry of templates(); track entry.name) {
                <button
                  class="btn btn-ghost btn-sm w-full justify-start gap-3 font-normal"
                  [disabled]="adding()"
                  (click)="addFromTemplate(entry.name)"
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
  private electron = inject(ElectronService);

  protected showAddSystem = signal(false);
  protected editingName = signal(false);
  protected adding = signal(false);
  protected templates = signal<TemplateListEntry[]>([]);

  protected async saveSite() {
    await this.workspace.save();
  }

  protected async addFromTemplate(templateName: string) {
    this.adding.set(true);
    try {
      await this.workspace.addSystemFromTemplate(templateName);
      this.showAddSystem.set(false);
    } finally {
      this.adding.set(false);
    }
  }

  protected async onAddClick() {
    this.templates.set(await this.electron.templateList());
    this.showAddSystem.set(true);
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
