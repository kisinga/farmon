import { Component, input, signal, effect, inject } from '@angular/core';
import { ApiService } from '../../../core/services/api.service';
import { ChartContainerComponent } from '../chart-container/chart-container.component';

@Component({
  selector: 'app-history-chart',
  standalone: true,
  imports: [ChartContainerComponent],
  template: `
    <app-chart-container
      [series]="series()"
      [title]="field()"
      [height]="280"
    />
    @if (loading()) {
      <span class="loading loading-spinner loading-xs"></span>
    }
    @if (error()) {
      <p class="text-error text-sm">{{ error() }}</p>
    }
  `,
})
export class HistoryChartComponent {
  private api = inject(ApiService);

  eui = input.required<string>();
  field = input.required<string>();
  from = input<string>('');
  to = input<string>('');

  series = signal<Array<{ name: string; data: Array<{ ts: string; value: number }> }>>([]);
  loading = signal(true);
  error = signal<string | null>(null);

  constructor() {
    effect(() => {
      const eui = this.eui();
      const fieldName = this.field();
      const from = this.from();
      const to = this.to();
      if (!eui || !fieldName) {
        this.series.set([]);
        this.loading.set(false);
        return;
      }
      this.loading.set(true);
      this.error.set(null);
      this.api.getHistory(eui, fieldName, from || undefined, to || undefined).subscribe({
        next: (res) => {
          this.series.set([{ name: fieldName, data: res?.data ?? [] }]);
          this.loading.set(false);
        },
        error: (err) => {
          this.error.set(err?.message ?? 'Failed to load history');
          this.series.set([]);
          this.loading.set(false);
        },
      });
    });
  }
}
