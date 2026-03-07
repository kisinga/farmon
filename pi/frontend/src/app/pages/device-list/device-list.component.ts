import { Component, inject, signal, OnInit } from '@angular/core';
import { RouterLink } from '@angular/router';
import { ApiService, Device } from '../../core/services/api.service';
import { DatePipe } from '@angular/common';

@Component({
  selector: 'app-device-list',
  standalone: true,
  imports: [RouterLink, DatePipe],
  template: `
    <div class="card bg-base-100 shadow-xl">
      <div class="card-body">
        <h2 class="card-title">Devices</h2>
        @if (loading()) {
          <span class="loading loading-spinner loading-md"></span>
        } @else if (error()) {
          <div class="alert alert-error">{{ error() }}</div>
        } @else {
          <div class="overflow-x-auto">
            <table class="table table-zebra">
              <thead>
                <tr>
                  <th>EUI</th>
                  <th>Name</th>
                  <th>Type</th>
                  <th>Last seen</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                @for (d of devices(); track d.device_eui) {
                  <tr>
                    <td class="font-mono">{{ d.device_eui }}</td>
                    <td>{{ d.device_name || '—' }}</td>
                    <td>{{ d.device_type || '—' }}</td>
                    <td>{{ d.last_seen ? (d.last_seen | date:'short') : '—' }}</td>
                    <td><a [routerLink]="['/device', d.device_eui]" class="btn btn-sm btn-primary">Open</a></td>
                  </tr>
                } @empty {
                  <tr><td colspan="5" class="text-center text-base-content/60">No devices yet. ChirpStack uplinks will create them.</td></tr>
                }
              </tbody>
            </table>
          </div>
        }
      </div>
    </div>
  `,
})
export class DeviceListComponent implements OnInit {
  private api = inject(ApiService);
  devices = signal<Device[]>([]);
  loading = signal(true);
  error = signal<string | null>(null);

  ngOnInit() {
    this.api.getDevices().subscribe({
      next: res => {
        this.devices.set(res?.items ?? []);
        this.loading.set(false);
      },
      error: err => {
        this.error.set(err?.message ?? 'Failed to load devices');
        this.loading.set(false);
      },
    });
  }
}
