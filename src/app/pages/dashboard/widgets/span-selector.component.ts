import { Component, input, output } from '@angular/core';
import { SPAN_PRESETS } from '../telemetry.store';

/**
 * Chart timescale picker — inline segment buttons (not a native `<select>`, whose
 * dropdown popup floats over the chart/tank above it). Shared by the tank history
 * panel and the line/flow cards so every trend uses the same control. `stopPropagation`
 * keeps a click off any surrounding toggle.
 */
@Component({
  selector: 'app-span-selector',
  standalone: true,
  template: `
    <div class="join">
      @for (p of presets; track p.hours) {
        <button type="button"
          class="join-item btn btn-xs {{ span() === p.hours ? 'btn-primary' : 'btn-ghost' }}"
          (click)="$event.stopPropagation(); spanChange.emit(p.hours)">{{ p.label }}</button>
      }
    </div>
  `,
})
export class SpanSelectorComponent {
  readonly span = input.required<number>();
  readonly spanChange = output<number>();
  protected readonly presets = SPAN_PRESETS;
}
