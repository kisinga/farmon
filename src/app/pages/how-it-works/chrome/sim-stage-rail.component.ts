import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import type { Stage } from '../stages';

/**
 * Top-right stage selector: one chip per stage. Hidden on narrow portrait screens
 * (the global stylesheet); there, swiping moves between stages. Emits the chosen
 * stage index; the engine jumps there and pauses.
 */
@Component({
  selector: 'sim-stage-rail',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'rail' },
  template: `
    @for (s of stages(); track $index) {
      <div class="chip" [class.active]="$index === active()" (click)="select.emit($index)">
        <span class="n">{{ $index + 1 }}</span>{{ s.short }}
      </div>
    }
  `,
})
export class SimStageRailComponent {
  readonly stages = input.required<Stage[]>();
  readonly active = input.required<number>();
  readonly select = output<number>();
}
