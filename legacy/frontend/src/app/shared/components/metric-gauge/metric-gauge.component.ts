import { Component, input } from '@angular/core';

@Component({
  selector: 'app-metric-gauge',
  standalone: true,
  template: `
    <div class="rounded-xl border border-base-300 bg-base-100 p-4 text-center shadow-sm">
      <p class="text-2xl font-bold text-base-content">{{ value() }}{{ unit() ? ' ' + unit() : '' }}</p>
      <p class="text-sm text-base-content/60 mt-0.5">{{ label() }}</p>
      @if (min() !== undefined && max() !== undefined) {
        <div class="mt-2 h-1.5 w-full rounded-full bg-base-200 overflow-hidden">
          <div
            class="h-full rounded-full bg-primary transition-all duration-300"
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
