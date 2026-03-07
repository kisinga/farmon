import { Component, inject, signal, OnInit } from '@angular/core';
import { DatePipe } from '@angular/common';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { ApiService, Device } from '../../core/services/api.service';

@Component({
  selector: 'app-device-detail',
  standalone: true,
  imports: [RouterLink, DatePipe],
  template: `
    <div class="card bg-base-100 shadow-xl">
      <div class="card-body">
        <div class="flex items-center gap-2">
          <a routerLink="/" class="btn btn-ghost btn-sm">← Back</a>
          <h2 class="card-title">{{ eui() }}</h2>
        </div>
        @if (loading()) {
          <span class="loading loading-spinner loading-md"></span>
        } @else if (device()) {
          <div class="grid gap-4">
            <p><strong>Name:</strong> {{ device()!.device_name || '—' }}</p>
            <p><strong>Type:</strong> {{ device()!.device_type || '—' }}</p>
            <p><strong>Last seen:</strong> {{ device()!.last_seen ? (device()!.last_seen | date:'medium') : '—' }}</p>
          </div>
          <p class="text-sm text-base-content/60">Controls, history, rules, and OTA will be added in Phase 3.</p>
        } @else if (error()) {
          <div class="alert alert-error">{{ error() }}</div>
        }
      </div>
    </div>
  `,
})
export class DeviceDetailComponent implements OnInit {
  private route = inject(ActivatedRoute);
  private api = inject(ApiService);
  eui = signal<string>('');
  device = signal<Device | null>(null);
  loading = signal(true);
  error = signal<string | null>(null);

  ngOnInit() {
    const eui = this.route.snapshot.paramMap.get('eui');
    if (eui) this.eui.set(eui);
    if (!eui) {
      this.error.set('Missing device EUI');
      this.loading.set(false);
      return;
    }
    this.api.getDeviceConfig(eui).subscribe({
      next: d => {
        this.device.set(d);
        this.loading.set(false);
      },
      error: err => {
        this.error.set(err?.message ?? 'Device not found');
        this.loading.set(false);
      },
    });
  }
}
