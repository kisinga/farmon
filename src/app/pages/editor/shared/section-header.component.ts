import { Component, input } from '@angular/core';

/**
 * The one header treatment shared by every workspace/admin page (Sites, Devices,
 * Config, Sharing, Firmware…). Carries the marketing site's visual language into
 * the app: a glowing cyan→sky gradient accent bar, a bold display title, and a
 * faint cyan ambient bloom behind it — so admin pages feel alive, not flat, while
 * still reading as one coherent set. Presentational only; sits atop a `.content-pane`.
 */
@Component({
  selector: 'app-section-header',
  standalone: true,
  template: `
    <header class="relative isolate">
      <!-- Ambient cyan bloom, echoing the homepage's glow blobs. Behind everything,
           non-interactive; the isolate keeps the negative z scoped to this header. -->
      <div aria-hidden="true"
        class="pointer-events-none absolute -top-9 -left-8 -z-10 h-28 w-64 rounded-full bg-cyan-500/10 blur-3xl"></div>
      <div class="flex items-center gap-3">
        <span class="w-1.5 h-7 rounded-full shrink-0 bg-gradient-to-b from-cyan-300 to-sky-500 shadow-[0_0_16px_-2px] shadow-cyan-400/60"></span>
        <h1 class="app-title text-2xl font-bold">{{ title() }}</h1>
      </div>
      @if (subtitle()) {
        <p class="text-sm text-base-content/50 mt-2 max-w-2xl leading-relaxed">{{ subtitle() }}</p>
      }
    </header>
  `,
})
export class SectionHeaderComponent {
  readonly title = input.required<string>();
  readonly subtitle = input<string>('');
}
