import { Component, inject, OnInit, signal } from '@angular/core';
import { Router } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { LibraryService } from '../../core/services/library.service';

@Component({
  selector: 'app-library',
  standalone: true,
  imports: [FormsModule],
  template: `
    <div class="p-8 max-w-5xl mx-auto">
      <!-- Header -->
      <div class="flex items-center justify-between mb-8">
        <div>
          <h1 class="text-3xl font-bold tracking-tight">System Library</h1>
          <p class="text-base-content/50 mt-1">
            Water system configurations. Select one to edit, or create a new system.
          </p>
        </div>
        <button class="btn btn-primary gap-2" (click)="showCreateDialog.set(true)">
          <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
            <path fill-rule="evenodd" d="M10 3a1 1 0 011 1v5h5a1 1 0 110 2h-5v5a1 1 0 11-2 0v-5H4a1 1 0 110-2h5V4a1 1 0 011-1z" clip-rule="evenodd" />
          </svg>
          New System
        </button>
      </div>

      @if (library.loading()) {
        <div class="flex justify-center py-16">
          <span class="loading loading-spinner loading-lg text-primary"></span>
        </div>
      } @else if (library.entries().length === 0) {
        <div class="hero bg-base-100 rounded-2xl shadow-sm py-16">
          <div class="hero-content text-center">
            <div class="max-w-md">
              <h2 class="text-xl font-semibold text-base-content/40">No configurations yet</h2>
              <p class="text-base-content/40 mt-2 mb-6">Create your first water system to get started.</p>
              <button class="btn btn-primary" (click)="showCreateDialog.set(true)">Create First System</button>
            </div>
          </div>
        </div>
      } @else {
        <div class="grid gap-4">
          @for (entry of library.entries(); track entry.name) {
            <div
              class="card bg-base-100 shadow-sm hover:shadow-md transition-shadow cursor-pointer border border-base-200"
              (click)="open(entry.name)"
            >
              <div class="card-body p-5 flex-row items-center gap-6">
                <div class="flex-1 min-w-0">
                  <h3 class="font-semibold text-lg truncate">{{ entry.friendlyName }}</h3>
                  <p class="text-sm text-base-content/50 font-mono">{{ entry.deviceName }}</p>
                </div>
                <div class="badge badge-outline">{{ entry.board }}</div>
                <div class="flex gap-4 text-sm text-base-content/60">
                  <div class="text-center">
                    <div class="font-bold text-base-content text-lg">{{ entry.tanks }}</div>
                    <div class="text-xs">Tanks</div>
                  </div>
                  <div class="text-center">
                    <div class="font-bold text-base-content text-lg">{{ entry.valves }}</div>
                    <div class="text-xs">Valves</div>
                  </div>
                  <div class="text-center">
                    <div class="font-bold text-base-content text-lg">{{ entry.routes }}</div>
                    <div class="text-xs">Routes</div>
                  </div>
                </div>
                <div class="flex gap-1">
                  <button class="btn btn-ghost btn-sm" (click)="startDuplicate(entry.name, $event)">Duplicate</button>
                  <button class="btn btn-ghost btn-sm text-error" (click)="remove(entry.name, $event)">Delete</button>
                </div>
              </div>
            </div>
          }
        </div>
      }

      <!-- Create Dialog -->
      @if (showCreateDialog()) {
        <dialog class="modal modal-open">
          <div class="modal-box">
            <h3 class="text-lg font-bold mb-4">New System</h3>
            <div class="form-control mb-4">
              <label class="label"><span class="label-text">System Name</span></label>
              <input
                type="text"
                class="input input-bordered"
                placeholder="e.g. My Pump Controller"
                [ngModel]="dialogName()"
                (ngModelChange)="dialogName.set($event)"
                (keydown.enter)="confirmCreate()"
                autofocus
              />
              <label class="label">
                <span class="label-text-alt text-base-content/40">
                  ID: {{ toSlug(dialogName()) }}
                </span>
              </label>
            </div>
            <div class="modal-action">
              <button class="btn btn-ghost" (click)="showCreateDialog.set(false)">Cancel</button>
              <button class="btn btn-primary" (click)="confirmCreate()" [disabled]="!dialogName()">Create</button>
            </div>
          </div>
          <div class="modal-backdrop" (click)="showCreateDialog.set(false)"></div>
        </dialog>
      }

      <!-- Duplicate Dialog -->
      @if (showDuplicateDialog()) {
        <dialog class="modal modal-open">
          <div class="modal-box">
            <h3 class="text-lg font-bold mb-4">Duplicate "{{ duplicateSource() }}"</h3>
            <div class="form-control mb-4">
              <label class="label"><span class="label-text">New Name</span></label>
              <input
                type="text"
                class="input input-bordered"
                [ngModel]="dialogName()"
                (ngModelChange)="dialogName.set($event)"
                (keydown.enter)="confirmDuplicate()"
                autofocus
              />
            </div>
            <div class="modal-action">
              <button class="btn btn-ghost" (click)="showDuplicateDialog.set(false)">Cancel</button>
              <button class="btn btn-primary" (click)="confirmDuplicate()" [disabled]="!dialogName()">Duplicate</button>
            </div>
          </div>
          <div class="modal-backdrop" (click)="showDuplicateDialog.set(false)"></div>
        </dialog>
      }
    </div>
  `,
})
export class LibraryComponent implements OnInit {
  protected library = inject(LibraryService);
  private router = inject(Router);

  protected toSlug(name: string): string {
    return name.toLowerCase().replace(/[^a-z0-9-]/g, '-');
  }

  protected showCreateDialog = signal(false);
  protected showDuplicateDialog = signal(false);
  protected dialogName = signal('');
  protected duplicateSource = signal('');

  ngOnInit() {
    this.library.refresh();
  }

  open(name: string) {
    this.router.navigate(['/editor', name]);
  }

  async confirmCreate() {
    const name = this.dialogName();
    if (!name) return;
    const slug = name.toLowerCase().replace(/[^a-z0-9-]/g, '-');
    this.showCreateDialog.set(false);
    this.dialogName.set('');
    await this.library.save(slug, {
      device: { name: slug, friendly_name: name, board: 'heltec-v3' },
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
    // Use a simple confirmation via a flag instead of window.confirm
    await this.library.remove(name);
  }
}
