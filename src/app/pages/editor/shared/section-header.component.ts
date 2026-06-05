import { Component, input } from '@angular/core';

/**
 * The one header treatment shared by every workspace section (Config, Schedules,
 * Sharing, Firmware). A cyan accent bar + title + optional one-line subtitle, so
 * the sections read as one coherent set rather than each inventing its own.
 * Presentational only — sits at the top of a `.content-pane`.
 */
@Component({
  selector: 'app-section-header',
  standalone: true,
  template: `
    <header>
      <div class="flex items-center gap-2.5">
        <span class="w-1 h-5 rounded-full bg-primary/80 shrink-0"></span>
        <h1 class="text-xl font-semibold tracking-tight">{{ title() }}</h1>
      </div>
      @if (subtitle()) {
        <p class="text-sm text-base-content/50 mt-1.5 max-w-2xl leading-relaxed">{{ subtitle() }}</p>
      }
    </header>
  `,
})
export class SectionHeaderComponent {
  readonly title = input.required<string>();
  readonly subtitle = input<string>('');
}
