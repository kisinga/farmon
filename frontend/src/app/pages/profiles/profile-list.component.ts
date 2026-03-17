import { Component, inject, signal, OnInit } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { ApiService, ProfileSummary } from '../../core/services/api.service';

@Component({
  selector: 'app-profile-list',
  standalone: true,
  imports: [RouterLink, FormsModule],
  template: `
    <header class="page-header flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
      <div>
        <h1 class="page-title">Profiles</h1>
        <p class="page-description">
          Device profiles define fields, controls, commands, and decode rules. Assign a profile when provisioning a device.
        </p>
      </div>
      <button class="btn btn-primary btn-sm" (click)="showCreateModal.set(true)">+ Create profile</button>
    </header>

    <div class="card-elevated">
      <div class="card-body-spaced">
        @if (loading()) {
          <div class="flex flex-col items-center justify-center py-12 gap-4">
            <span class="loading loading-spinner loading-lg text-primary"></span>
            <p class="text-base-content/60">Loading profiles…</p>
          </div>
        } @else if (error()) {
          <div class="alert alert-error rounded-xl">
            <span>{{ error() }}</span>
          </div>
        } @else if (profiles().length === 0) {
          <div class="flex flex-col items-center justify-center py-12 px-4 text-center">
            <h2 class="text-lg font-semibold text-base-content mb-1">No profiles</h2>
            <p class="text-base-content/70 text-sm max-w-md mb-4">
              Create a profile to define device fields, controls, and decode rules.
            </p>
            <button class="btn btn-primary btn-sm" (click)="showCreateModal.set(true)">+ Create profile</button>
          </div>
        } @else {
          <div class="overflow-x-auto rounded-xl border border-base-300">
            <table class="table table-zebra">
              <thead>
                <tr class="bg-base-200/60">
                  <th class="font-semibold">Name</th>
                  <th class="font-semibold">Type</th>
                  <th class="font-semibold hidden sm:table-cell">Transport</th>
                  <th class="font-semibold hidden sm:table-cell">Template</th>
                  <th class="font-semibold hidden md:table-cell">Description</th>
                  <th class="font-semibold w-28">Actions</th>
                </tr>
              </thead>
              <tbody>
                @for (p of profiles(); track p.id) {
                  <tr class="hover cursor-pointer" (click)="openProfile(p.id)">
                    <td class="font-medium">{{ p.name }}</td>
                    <td>
                      <span class="badge badge-sm" [class.badge-primary]="p.profile_type === 'airconfig'" [class.badge-secondary]="p.profile_type === 'codec'">{{ p.profile_type }}</span>
                    </td>
                    <td class="hidden sm:table-cell">
                      @if (p.transport) {
                        <span class="badge badge-sm" [class.badge-primary]="p.transport === 'lorawan'" [class.badge-secondary]="p.transport === 'wifi'">{{ p.transport }}</span>
                      } @else {
                        <span class="badge badge-sm badge-ghost">any</span>
                      }
                    </td>
                    <td class="hidden sm:table-cell">
                      @if (p.is_template) {
                        <span class="badge badge-ghost badge-sm">template</span>
                      }
                    </td>
                    <td class="hidden md:table-cell text-base-content/70 text-sm">{{ p.description || '—' }}</td>
                    <td>
                      <div class="flex gap-1" (click)="$event.stopPropagation()">
                        <a [routerLink]="['/profiles', p.id]" class="btn btn-ghost btn-xs">Edit</a>
                        <button class="btn btn-ghost btn-xs text-error" (click)="deleteProfile(p)">Del</button>
                      </div>
                    </td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
        }
      </div>
    </div>

    <!-- Create profile modal -->
    @if (showCreateModal()) {
      <div class="modal modal-open">
        <div class="modal-box">
          <h3 class="font-bold text-lg mb-4">Create profile</h3>
          <div class="form-control w-full">
            <label class="label"><span class="label-text font-semibold">Name *</span></label>
            <input type="text" class="input input-bordered w-full" [(ngModel)]="newName" placeholder="e.g. My Sensor v1" />
          </div>
          <div class="form-control w-full mt-3">
            <label class="label"><span class="label-text font-semibold">Description</span></label>
            <textarea class="textarea textarea-bordered w-full" rows="2" [(ngModel)]="newDescription" placeholder="Optional description"></textarea>
          </div>
          <div class="form-control w-full mt-3">
            <label class="label"><span class="label-text font-semibold">Type *</span></label>
            <select class="select select-bordered w-full" [(ngModel)]="newType">
              <option value="airconfig">airconfig — OTA-configurable (controls, commands, config push)</option>
              <option value="codec">codec — decode-only (telemetry fields + decode rules)</option>
            </select>
          </div>
          <div class="form-control w-full mt-3">
            <label class="label"><span class="label-text font-semibold">Transport compatibility</span></label>
            <select class="select select-bordered select-sm w-full" [(ngModel)]="newTransport" name="newTransport">
              <option value="">Any transport</option>
              <option value="lorawan">LoRaWAN only</option>
              <option value="wifi">WiFi only</option>
            </select>
            <span class="label-text-alt text-base-content/50">Restricts which devices can use this profile</span>
          </div>
          @if (createError()) {
            <div class="alert alert-error rounded-xl mt-3">
              <span>{{ createError() }}</span>
            </div>
          }
          <div class="modal-action">
            <button class="btn btn-ghost" (click)="closeCreateModal()">Cancel</button>
            <button class="btn btn-primary" [disabled]="creating() || !newName.trim()" (click)="createProfile()">
              @if (creating()) {
                <span class="loading loading-spinner loading-sm"></span> Creating…
              } @else {
                Create
              }
            </button>
          </div>
        </div>
        <div class="modal-backdrop" (click)="closeCreateModal()"></div>
      </div>
    }
  `,
})
export class ProfileListComponent implements OnInit {
  private api = inject(ApiService);
  private router = inject(Router);

  profiles = signal<ProfileSummary[]>([]);
  loading = signal(true);
  error = signal<string | null>(null);

  // Create modal
  showCreateModal = signal(false);
  newName = '';
  newDescription = '';
  newType = 'airconfig';
  newTransport = 'lorawan';
  creating = signal(false);
  createError = signal<string | null>(null);

  ngOnInit() {
    this.loadProfiles();
  }

  loadProfiles() {
    this.loading.set(true);
    this.error.set(null);
    this.api.getProfiles(false).subscribe({
      next: (list) => {
        this.profiles.set(list);
        this.loading.set(false);
      },
      error: (err) => {
        this.error.set(err?.message ?? 'Failed to load profiles');
        this.loading.set(false);
      },
    });
  }

  openProfile(id: string): void {
    this.router.navigate(['/profiles', id]);
  }

  deleteProfile(p: ProfileSummary): void {
    if (!confirm(`Delete profile "${p.name}"? This will also delete all its fields, controls, commands, and decode rules.`)) return;
    this.api.deleteProfile(p.id).subscribe({
      next: () => this.loadProfiles(),
      error: (err) => this.error.set(err?.message ?? 'Failed to delete'),
    });
  }

  closeCreateModal(): void {
    this.showCreateModal.set(false);
    this.newName = '';
    this.newDescription = '';
    this.newType = 'airconfig';
    this.newTransport = 'lorawan';
    this.createError.set(null);
  }

  createProfile(): void {
    if (!this.newName.trim()) return;
    this.creating.set(true);
    this.createError.set(null);
    this.api.createProfile({
      name: this.newName.trim(),
      description: this.newDescription.trim(),
      profile_type: this.newType,
      transport: this.newTransport,
      is_template: true,
    }).subscribe({
      next: (created) => {
        this.creating.set(false);
        this.showCreateModal.set(false);
        this.router.navigate(['/profiles', created.id]);
      },
      error: (err) => {
        this.creating.set(false);
        this.createError.set(err?.error?.message ?? err?.message ?? 'Failed to create profile');
      },
    });
  }
}
