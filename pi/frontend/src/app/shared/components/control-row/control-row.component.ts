import { Component, input, output, signal } from '@angular/core';

@Component({
  selector: 'app-control-row',
  standalone: true,
  template: `
    <div class="flex flex-wrap items-center gap-2 rounded-lg border border-base-300 bg-base-100 p-3">
      <span class="font-medium">{{ controlKey() }}</span>
      <span class="badge badge-ghost">{{ currentState() }}</span>
      <div class="flex gap-1">
        <button type="button" class="btn btn-sm btn-primary" (click)="emitSetState('on')">On</button>
        <button type="button" class="btn btn-sm btn-secondary" (click)="emitSetState('off')">Off</button>
        @if (showClear()) {
          <button type="button" class="btn btn-sm btn-ghost" (click)="clearOverride.emit()">Clear override</button>
        }
      </div>
      @if (withDuration()) {
        <div class="flex items-center gap-1">
          <label class="label text-xs">Duration (s)</label>
          <input type="number" class="input input-bordered input-sm w-20" min="0" [value]="durationSec()" (input)="durationSec.set(+($any($event.target).value) || 0)" placeholder="0" />
        </div>
      }
    </div>
  `,
})
export class ControlRowComponent {
  controlKey = input.required<string>();
  currentState = input<string>('off');
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
