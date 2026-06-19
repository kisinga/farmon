import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';

/**
 * Bottom transport bar: prev / play-pause / next, the progress track and the
 * "n / total" label. Presentational: it renders engine state and emits intent.
 */
@Component({
  selector: 'sim-transport',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'transport' },
  template: `
    <div class="tbtn" title="Previous" (click)="prev.emit()">
      <svg viewBox="0 0 24 24" fill="currentColor"><path d="M7 5h2v14H7zm3 7l8 7V5z" /></svg>
    </div>
    <div class="tbtn play" title="Play / Pause" (click)="toggle.emit()">
      @if (playing()) {
        <svg viewBox="0 0 24 24" fill="currentColor"><path d="M6 5h4v14H6zM14 5h4v14h-4z" /></svg>
      } @else {
        <svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z" /></svg>
      }
    </div>
    <div class="tbtn" title="Next" (click)="next.emit()">
      <svg viewBox="0 0 24 24" fill="currentColor"><path d="M15 5h2v14h-2zM6 5l8 7-8 7z" /></svg>
    </div>
    <div class="track"><div class="fill" [style.width.%]="progress()"></div></div>
    <div class="tlabel">{{ label() }}</div>
  `,
})
export class SimTransportComponent {
  readonly playing = input(false);
  readonly progress = input(0);
  readonly label = input('1 / 8');
  readonly toggle = output<void>();
  readonly next = output<void>();
  readonly prev = output<void>();
}
