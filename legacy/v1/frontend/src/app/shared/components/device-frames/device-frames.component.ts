import { Component, inject, input, signal, effect, OnDestroy } from '@angular/core';
import { DatePipe } from '@angular/common';
import { ApiService, RawLorawanFrame } from '../../../core/services/api.service';

@Component({
  selector: 'app-device-frames',
  standalone: true,
  imports: [DatePipe],
  template: `
    <div class="space-y-3">
      <div class="flex items-center justify-between">
        <h3 class="text-sm font-medium text-base-content/70">Recent Frames</h3>
        <button class="btn btn-ghost btn-xs" (click)="reload()">Refresh</button>
      </div>
      @if (loading()) {
        <div class="flex justify-center py-4">
          <span class="loading loading-spinner loading-sm"></span>
        </div>
      } @else if (frames().length === 0) {
        <p class="text-base-content/50 text-sm">No frames recorded for this device.</p>
      } @else {
        <div class="overflow-x-auto">
          <table class="table table-xs w-full">
            <thead>
              <tr>
                <th>Time</th>
                <th>Dir</th>
                <th>fPort</th>
                <th>Kind</th>
                <th>RSSI</th>
                <th>SNR</th>
                <th>Payload</th>
                <th>Error</th>
              </tr>
            </thead>
            <tbody>
              @for (f of frames(); track f.time + f.direction + f.f_port) {
                <tr>
                  <td class="text-xs text-base-content/60 whitespace-nowrap">{{ f.time | date:'short' }}</td>
                  <td>
                    <span class="badge badge-xs" [class.badge-info]="f.direction === 'up'" [class.badge-accent]="f.direction === 'down'">{{ f.direction }}</span>
                  </td>
                  <td class="font-mono text-xs">{{ f.f_port }}</td>
                  <td class="text-xs">{{ f.kind }}</td>
                  <td class="text-xs font-mono">{{ f.rssi ?? '—' }}</td>
                  <td class="text-xs font-mono">{{ f.snr ?? '—' }}</td>
                  <td class="text-xs font-mono max-w-[200px] truncate" [title]="f.payload_hex">{{ f.payload_hex || '—' }}</td>
                  <td class="text-xs text-error">{{ f.error || '' }}</td>
                </tr>
              }
            </tbody>
          </table>
        </div>
      }
    </div>
  `,
})
export class DeviceFramesComponent implements OnDestroy {
  private api = inject(ApiService);

  eui = input.required<string>();
  frames = signal<RawLorawanFrame[]>([]);
  loading = signal(false);

  private loadEffect = effect(() => {
    const eui = this.eui();
    if (!eui) return;
    this.loadFrames(eui);
  });

  reload(): void {
    const eui = this.eui();
    if (eui) this.loadFrames(eui);
  }

  private loadFrames(eui: string): void {
    this.loading.set(true);
    this.api.getDeviceFrames(eui, 50).subscribe({
      next: (frames) => {
        this.frames.set(frames);
        this.loading.set(false);
      },
      error: () => this.loading.set(false),
    });
  }

  ngOnDestroy(): void {
    // effect cleanup is automatic
  }
}
