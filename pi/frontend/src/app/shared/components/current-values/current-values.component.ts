import { Component, input } from '@angular/core';
import { MetricGaugeComponent } from '../metric-gauge/metric-gauge.component';
import { ValuePillComponent } from '../value-pill/value-pill.component';
import type { DeviceField } from '../../../core/services/api.service';

@Component({
  selector: 'app-current-values',
  standalone: true,
  imports: [MetricGaugeComponent],
  template: `
    <div class="grid gap-2 grid-cols-2 md:grid-cols-3">
      @for (f of fields(); track f.id) {
        @let val = valueFor(f.field_key);
        <app-metric-gauge
          [label]="f.display_name || f.field_key"
          [value]="val"
          [unit]="f.unit ?? ''"
          [min]="f.min_value"
          [max]="f.max_value"
        />
      }
    </div>
  `,
})
export class CurrentValuesComponent {
  fields = input.required<DeviceField[]>();
  data = input<Record<string, unknown>>({});

  valueFor(key: string): string | number {
    const d = this.data();
    const v = d?.[key];
    if (v === undefined || v === null) return '—';
    if (typeof v === 'number' || typeof v === 'string') return v;
    return String(v);
  }
}
