import { Component, input, output, signal, computed } from '@angular/core';
import { FormsModule } from '@angular/forms';

@Component({
  selector: 'app-control-row',
  standalone: true,
  imports: [FormsModule],
  template: `
    <div class="flex flex-wrap items-center gap-3 rounded-xl border border-base-300 bg-base-200/30 p-4">
      <div class="flex items-center gap-2 min-w-0">
        <span class="font-semibold capitalize">{{ displayName() || controlKey() }}</span>
        @if (controlType() === 'analog') {
          <span class="badge badge-ghost badge-sm">{{ currentValue() ?? '—' }}</span>
        } @else {
          <span class="badge badge-ghost badge-sm">{{ currentValue() ?? currentState() }}</span>
        }
      </div>

      <div class="flex flex-wrap items-center gap-2">
        @if (controlType() === 'analog' && maxValue() > 0) {
          <!-- Analog slider -->
          <input type="range" class="range range-sm range-primary w-32"
            [min]="minValue()" [max]="maxValue()" [step]="analogStep()"
            [ngModel]="sliderValue()"
            (ngModelChange)="sliderValue.set(+$event)" />
          <input type="number" class="input input-bordered input-xs w-20"
            [min]="minValue()" [max]="maxValue()"
            [ngModel]="sliderValue()"
            (ngModelChange)="sliderValue.set(+$event)" />
          <button type="button" class="btn btn-sm btn-primary" (click)="emitSetValue()">Set</button>
        } @else {
          <!-- Binary / multistate buttons -->
          @if (stateNames().length > 0) {
            @for (s of stateNames(); track s) {
              <button
                type="button"
                class="btn btn-sm"
                [class.btn-primary]="(currentValue() ?? currentState()) === s"
                [class.btn-outline]="(currentValue() ?? currentState()) !== s"
                (click)="emitSetState(s)"
              >{{ s }}</button>
            }
          } @else {
            <button type="button" class="btn btn-sm btn-primary" (click)="emitSetState('on')">On</button>
            <button type="button" class="btn btn-sm btn-outline" (click)="emitSetState('off')">Off</button>
          }
        }

        @if (showClear()) {
          <button type="button" class="btn btn-sm btn-ghost" (click)="clearOverride.emit()">Clear override</button>
        }
        @if (withDuration()) {
          <div class="flex items-center gap-2">
            <label class="label py-0 text-xs text-base-content/70">Duration (s)</label>
            <input type="number" class="input input-bordered input-sm w-20" min="0"
              [ngModel]="durationSec()" (ngModelChange)="durationSec.set(+$event || 0)" placeholder="0" />
          </div>
        }
      </div>
    </div>
  `,
})
export class ControlRowComponent {
  controlKey = input.required<string>();
  currentState = input<string>('off');
  displayName = input<string>('');
  stateNames = input<string[]>([]);
  showClear = input<boolean>(true);
  withDuration = input<boolean>(false);
  controlType = input<'binary' | 'multistate' | 'analog'>('binary');
  currentValue = input<number | string | null>(null);
  minValue = input<number>(0);
  maxValue = input<number>(0);

  setState = output<{ state: string; duration?: number }>();
  setValue = output<{ value: number; duration?: number }>();
  clearOverride = output<void>();

  durationSec = signal(0);
  sliderValue = signal(0);

  /** Step size for analog slider: 1 for integer ranges, 0.1 for small ranges. */
  analogStep = computed(() => {
    const range = this.maxValue() - this.minValue();
    return range <= 10 ? 0.1 : 1;
  });

  emitSetState(state: string): void {
    const d = this.durationSec();
    this.setState.emit(d > 0 ? { state, duration: d } : { state });
  }

  emitSetValue(): void {
    const d = this.durationSec();
    this.setValue.emit(d > 0 ? { value: this.sliderValue(), duration: d } : { value: this.sliderValue() });
  }
}
