import { Component, input, signal, effect, inject } from '@angular/core';
import { DatePipe } from '@angular/common';
import { ApiService, FirmwareHistoryRecord } from '../../../core/services/api.service';

@Component({
  selector: 'app-ota-section',
  standalone: true,
  imports: [DatePipe],
  template: `
    <div class="space-y-2">
      <h3 class="text-lg font-semibold">OTA / Firmware</h3>
      <div class="flex gap-2">
        <button type="button" class="btn btn-sm btn-primary" (click)="startOta()" [disabled]="loading()">Start OTA</button>
        <button type="button" class="btn btn-sm btn-ghost" (click)="cancelOta()" [disabled]="loading()">Cancel OTA</button>
      </div>
      @if (message()) {
        <p class="text-sm" [class.text-error]="isError()" [class.text-success]="!isError()">{{ message() }}</p>
      }
      <h4 class="text-sm font-medium">History</h4>
      @if (history().length === 0 && !loadingHistory()) {
        <p class="text-sm text-base-content/60">No firmware history yet.</p>
      } @else {
        <div class="overflow-x-auto">
          <table class="table table-xs">
            <thead>
              <tr>
                <th>Started</th>
                <th>Outcome</th>
                <th>Version</th>
                <th>Chunks</th>
              </tr>
            </thead>
            <tbody>
              @for (r of history(); track r.id) {
                <tr>
                  <td>{{ r.started_at ? (r.started_at | date:'short') : '—' }}</td>
                  <td>{{ r.outcome }}</td>
                  <td>{{ r.firmware_version ?? '—' }}</td>
                  <td>{{ r.chunks_received ?? '—' }}/{{ r.total_chunks ?? '—' }}</td>
                </tr>
              }
            </tbody>
          </table>
        </div>
      }
    </div>
  `,
})
export class OtaSectionComponent {
  private api = inject(ApiService);

  eui = input.required<string>();
  history = signal<FirmwareHistoryRecord[]>([]);
  loadingHistory = signal(false);
  loading = signal(false);
  message = signal<string | null>(null);
  isError = signal(false);

  constructor() {
    effect(() => {
      const eui = this.eui();
      if (!eui) {
        this.history.set([]);
        return;
      }
      this.loadingHistory.set(true);
      this.api.getFirmwareHistory(eui).subscribe({
        next: (list) => {
          this.history.set(list);
          this.loadingHistory.set(false);
        },
        error: () => {
          this.history.set([]);
          this.loadingHistory.set(false);
        },
      });
    });
  }

  startOta(): void {
    const eui = this.eui();
    if (!eui) return;
    this.loading.set(true);
    this.message.set(null);
    this.api.otaStart(eui).subscribe({
      next: (res) => {
        this.isError.set(false);
        this.message.set(res?.message ?? 'OTA start requested.');
        this.loading.set(false);
        this.api.getFirmwareHistory(eui).subscribe((list) => this.history.set(list));
      },
      error: (err) => {
        this.isError.set(true);
        this.message.set(err?.error?.error ?? err?.message ?? 'Failed to start OTA');
        this.loading.set(false);
      },
    });
  }

  cancelOta(): void {
    const eui = this.eui();
    if (!eui) return;
    this.loading.set(true);
    this.message.set(null);
    this.api.otaCancel(eui).subscribe({
      next: (res) => {
        this.isError.set(false);
        this.message.set(res?.message ?? 'OTA cancel requested.');
        this.loading.set(false);
      },
      error: (err) => {
        this.isError.set(true);
        this.message.set(err?.error?.error ?? err?.message ?? 'Failed to cancel OTA');
        this.loading.set(false);
      },
    });
  }
}
