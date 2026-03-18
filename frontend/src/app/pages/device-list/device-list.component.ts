import { Component, inject, signal, computed, OnInit, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { ApiService, Device, ProfileSummary } from '../../core/services/api.service';
import { AddDeviceModalComponent } from '../../shared/components/add-device-modal/add-device-modal.component';

@Component({
  selector: 'app-device-list',
  standalone: true,
  imports: [RouterLink, AddDeviceModalComponent, FormsModule],
  template: `
    <header class="page-header flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
      <div>
        <h1 class="page-title">Devices</h1>
        <p class="page-description">
          Manage IoT devices. Provision a device to get started, or open a device to view telemetry and controls.
        </p>
      </div>
      <button type="button" class="btn btn-primary gap-2 shrink-0" (click)="openAddModal()">
        <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4" />
        </svg>
        Add device
      </button>
    </header>

    <div class="card-elevated">
      <div class="card-body-spaced">
        @if (loading()) {
          <div class="flex flex-col items-center justify-center py-12 gap-4">
            <span class="loading loading-spinner loading-lg text-primary"></span>
            <p class="text-base-content/60">Loading devices…</p>
          </div>
        } @else if (error()) {
          <div class="alert alert-error rounded-xl">
            <span>{{ error() }}</span>
          </div>
        } @else if (devices().length === 0) {
          <div class="flex flex-col items-center justify-center py-12 px-4 text-center">
            <div class="rounded-full bg-base-200 p-6 mb-4">
              <svg xmlns="http://www.w3.org/2000/svg" class="h-12 w-12 text-base-content/40" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
              </svg>
            </div>
            <h2 class="text-lg font-semibold text-base-content mb-1">No devices yet</h2>
            <p class="text-base-content/70 text-sm max-w-md mb-6">
              Provision a device with a profile to get started, or wait for uplinks to create devices automatically.
            </p>
            <button type="button" class="btn btn-primary" (click)="openAddModal()">Add your first device</button>
          </div>
        } @else {
          <div class="flex flex-wrap items-center justify-end gap-2 mb-3">
            <input type="text" class="input input-bordered input-sm w-48" placeholder="Search name or EUI…" [ngModel]="searchQuery()" (ngModelChange)="searchQuery.set($event)" />
            <select class="select select-bordered select-sm" [ngModel]="transportFilter()" (ngModelChange)="transportFilter.set($event)" name="transportFilter">
              <option value="">All transports</option>
              <option value="lorawan">LoRaWAN</option>
              <option value="wifi">WiFi</option>
            </select>
          </div>
          <div class="overflow-x-auto rounded-xl border border-base-300">
            <table class="table table-zebra">
              <thead>
                <tr class="bg-base-200/60">
                  <th class="font-semibold">EUI</th>
                  <th class="font-semibold">Name</th>
                  <th class="font-semibold hidden sm:table-cell">Transport</th>
                  <th class="font-semibold hidden sm:table-cell">Type</th>
                  <th class="font-semibold hidden md:table-cell">Profile</th>
                  <th class="font-semibold hidden md:table-cell">Config</th>
                  <th class="font-semibold">Last seen</th>
                  <th class="text-right font-semibold">Action</th>
                </tr>
              </thead>
              <tbody>
                @for (d of filteredDevices(); track d.device_eui) {
                  <tr class="hover">
                    <td class="font-mono text-sm">{{ d.device_eui }}</td>
                    <td class="font-medium">{{ d.device_name || '—' }}</td>
                    <td class="hidden sm:table-cell">
                      <span class="badge badge-sm"
                        [class.badge-primary]="d.transport === 'lorawan' || !d.transport"
                        [class.badge-secondary]="d.transport === 'wifi'">
                        {{ d.transport || 'lorawan' }}
                      </span>
                    </td>
                    <td class="hidden sm:table-cell text-base-content/70">{{ d.device_type || '—' }}</td>
                    <td class="hidden md:table-cell">
                      @if (d.profile && profileMap().get(d.profile); as prof) {
                        <a [routerLink]="['/templates', d.profile]" class="link link-hover text-sm">{{ prof.name }}</a>
                      } @else {
                        <span class="text-base-content/40">—</span>
                      }
                    </td>
                    <td class="hidden md:table-cell">
                      @if (d.config_status === 'synced') {
                        <span class="badge badge-success badge-sm">synced</span>
                      } @else if (d.config_status === 'pending') {
                        <span class="badge badge-warning badge-sm">pending</span>
                      } @else {
                        <span class="badge badge-ghost badge-sm">n/a</span>
                      }
                    </td>
                    <td class="text-base-content/70 whitespace-nowrap">
                      {{ d.last_seen ? relativeTime(d.last_seen) : '—' }}
                    </td>
                    <td class="text-right">
                      <div class="flex gap-1 justify-end">
                      <a [routerLink]="['/device', d.device_eui]" class="btn btn-sm btn-primary btn-outline">Open</a>
                      <button
                        type="button"
                        class="btn btn-sm btn-ghost text-error hover:bg-error/10"
                        title="Delete device"
                        (click)="confirmDelete(d.device_eui, d.device_name || d.device_eui)"
                      >
                        Delete
                      </button>
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

    <app-add-device-modal #addModal (deviceAdded)="loadDevices()" />
  `,
})
export class DeviceListComponent implements OnInit {
  private api = inject(ApiService);
  private addModalRef = viewChild<AddDeviceModalComponent>('addModal');

  devices = signal<Device[]>([]);
  profiles = signal<ProfileSummary[]>([]);
  profileMap = computed(() => new Map(this.profiles().map(p => [p.id, p])));
  loading = signal(true);
  error = signal<string | null>(null);
  transportFilter = signal('');
  searchQuery = signal('');
  filteredDevices = computed(() => {
    const f = this.transportFilter();
    const q = this.searchQuery().toLowerCase();
    return this.devices().filter(dev => {
      if (f && (dev.transport || 'lorawan') !== f) return false;
      if (q && !dev.device_name?.toLowerCase().includes(q) && !dev.device_eui.toLowerCase().includes(q)) return false;
      return true;
    });
  });

  relativeTime(dateStr: string): string {
    const now = new Date();
    const d = new Date(dateStr);
    const diffMs = now.getTime() - d.getTime();
    const diffMin = Math.floor(diffMs / 60000);
    if (diffMin < 60) return diffMin <= 1 ? 'just now' : `${diffMin} min ago`;
    const isToday = d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
    if (isToday) return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
  }

  ngOnInit() {
    this.loadDevices();
    this.api.getProfiles(false).subscribe({
      next: (list) => this.profiles.set(list),
      error: () => {},
    });
  }

  openAddModal(): void {
    this.addModalRef()?.openModal();
  }

  loadDevices() {
    this.loading.set(true);
    this.error.set(null);
    this.api.getDevices().subscribe({
      next: (res) => {
        this.devices.set(res?.items ?? []);
        this.loading.set(false);
      },
      error: (err) => {
        this.error.set(err?.message ?? 'Failed to load devices');
        this.loading.set(false);
      },
    });
  }

  confirmDelete(eui: string, label: string): void {
    if (!confirm(`Delete device "${label}" (${eui})? This cannot be undone. The device can be re-registered later.`)) {
      return;
    }
    this.api.deleteDevice(eui).subscribe({
      next: () => this.loadDevices(),
      error: (err) => this.error.set(err?.error?.error ?? err?.message ?? 'Failed to delete device'),
    });
  }
}
