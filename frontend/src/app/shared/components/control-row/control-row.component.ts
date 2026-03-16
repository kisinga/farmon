import { Component, input, output, signal } from '@angular/core';

@Component({
  selector: 'app-control-row',
  standalone: true,
  template: `
    <div class="flex flex-wrap items-center gap-3 rounded-xl border border-base-300 bg-base-200/30 p-4">
      <div class="flex items-center gap-2 min-w-0">
        <span class="font-semibold capitalize">{{ displayName() || controlKey() }}</span>
        <span class="badge badge-ghost badge-sm">{{ currentState() }}</span>
      </div>
      <div class="flex flex-wrap items-center gap-2">
        @if (stateNames().length > 0) {
          @for (s of stateNames(); track s) {
            <button
              type="button"
              class="btn btn-sm"
              [class.btn-primary]="currentState() === s"
              [class.btn-outline]="currentState() !== s"
              (click)="emitSetState(s)"
            >{{ s }}</button>
          }
        } @else {
          <button type="button" class="btn btn-sm btn-primary" (click)="emitSetState('on')">On</button>
          <button type="button" class="btn btn-sm btn-outline" (click)="emitSetState('off')">Off</button>
        }
        @if (showClear()) {
          <button type="button" class="btn btn-sm btn-ghost" (click)="clearOverride.emit()">Clear override</button>
        }
        @if (withDuration()) {
          <div class="flex items-center gap-2">
            <label class="label py-0 text-xs text-base-content/70">Duration (s)</label>
            <input type="number" class="input input-bordered input-sm w-20" min="0" [value]="durationSec()" (input)="durationSec.set(+($any($event.target).value) || 0)" placeholder="0" />
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

  setState = output<{ state: string; duration?: number }>();
  clearOverride = output<void>();

  durationSec = signal(0);

  emitSetState(state: string): void {
    const d = this.durationSec();
    this.setState.emit(d > 0 ? { state, duration: d } : { state });
  }
}
