import { Component, input } from '@angular/core';

@Component({
  selector: 'app-metric-gauge',
  standalone: true,
  template: `
    <div class="rounded-lg border border-base-300 bg-base-100 p-3 text-center">
      <p class="text-2xl font-semibold">{{ value() }}{{ unit() ? ' ' + unit() : '' }}</p>
      <p class="text-sm text-base-content/60">{{ label() }}</p>
      @if (min() !== undefined && max() !== undefined) {
        <div class="mt-1 h-1 w-full rounded bg-base-300">
          <div
            class="h-1 rounded bg-primary transition-all"
            [style.width.%]="gaugePercent()"
          ></div>
        </div>
      }
    </div>
  `,
})
export class MetricGaugeComponent {
  label = input.required<string>();
  value = input<string | number>('—');
  unit = input<string>('');
  min = input<number | undefined>(undefined);
  max = input<number | undefined>(undefined);

  gaugePercent = () => {
    const v = this.value();
    const n = typeof v === 'number' ? v : parseFloat(String(v));
    if (isNaN(n)) return 0;
    const min = this.min() ?? 0;
    const max = this.max() ?? 100;
    if (max <= min) return 0;
    return Math.min(100, Math.max(0, ((n - min) / (max - min)) * 100));
  };
}
