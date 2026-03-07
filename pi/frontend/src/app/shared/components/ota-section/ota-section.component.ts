import { Component, input, signal, effect, inject } from '@angular/core';
import { DatePipe } from '@angular/common';
import { ApiService, FirmwareHistoryRecord } from '../../../core/services/api.service';

@Component({
  selector: 'app-ota-section',
  standalone: true,
  imports: [DatePipe],
  template: `
    <div class="space-y-4">
      <h2 class="section-title">OTA / Firmware</h2>
      <div class="flex flex-wrap gap-2">
        <button type="button" class="btn btn-primary btn-sm" (click)="startOta()" [disabled]="loading()">Start OTA</button>
        <button type="button" class="btn btn-ghost btn-sm" (click)="cancelOta()" [disabled]="loading()">Cancel OTA</button>
      </div>
      @if (message()) {
        <div class="alert text-sm rounded-xl" [class.alert-error]="isError()" [class.alert-success]="!isError()">
          <span>{{ message() }}</span>
        </div>
      }
      <div>
        <h3 class="text-sm font-semibold text-base-content mb-2">History</h3>
        @if (history().length === 0 && !loadingHistory()) {
          <p class="text-sm text-base-content/60">No firmware history yet.</p>
        } @else {
          <div class="overflow-x-auto rounded-xl border border-base-200">
            <table class="table table-sm">
              <thead>
                <tr class="bg-base-200/60">
                  <th class="font-semibold">Started</th>
                  <th class="font-semibold">Outcome</th>
                  <th class="font-semibold">Version</th>
                  <th class="font-semibold">Chunks</th>
                </tr>
              </thead>
              <tbody>
                @for (r of history(); track r.id) {
                  <tr>
                    <td class="text-base-content/80">{{ r.started_at ? (r.started_at | date:'short') : '—' }}</td>
                    <td><span class="badge badge-sm" [class.badge-success]="r.outcome === 'done'" [class.badge-error]="r.outcome === 'failed'" [class.badge-ghost]="r.outcome !== 'done' && r.outcome !== 'failed'">{{ r.outcome }}</span></td>
                    <td>{{ r.firmware_version ?? '—' }}</td>
                    <td>{{ r.chunks_received ?? '—' }}/{{ r.total_chunks ?? '—' }}</td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
        }
      </div>
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
