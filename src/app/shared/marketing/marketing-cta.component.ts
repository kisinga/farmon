import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { RouterLink } from '@angular/router';

/** A CTA button: internal `route` or external `href`. */
export interface CtaButton {
  label: string;
  route?: string;
  href?: string;
}

/**
 * Shared closing call-to-action band (the cyan→blue gradient card). Same treatment
 * on every page; only the heading, blurb, and buttons change. The first button is
 * the solid primary, the optional second is the outline secondary.
 */
@Component({
  selector: 'app-marketing-cta',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink],
  host: { class: 'contents' },
  template: `
    <section class="px-5 sm:px-8 py-16 sm:py-20">
      <div class="max-w-4xl mx-auto rounded-3xl bg-gradient-to-br from-cyan-500 via-sky-600 to-blue-700 px-6 sm:px-8 py-12 sm:py-14 text-center text-white shadow-2xl shadow-cyan-500/20">
        <h2 class="text-2xl sm:text-4xl font-bold tracking-tight">{{ heading() }}</h2>
        <p class="mt-3 text-white/85 max-w-xl mx-auto">{{ blurb() }}</p>
        <div class="mt-8 flex flex-wrap gap-3 justify-center">
          @for (b of buttons(); track b.label; let first = $first) {
            @let cls = first
              ? 'bg-white text-slate-900 hover:bg-slate-100'
              : 'ring-1 ring-white/40 text-white hover:bg-white/10';
            @if (b.href) {
              <a [href]="b.href" target="_blank" rel="noopener"
                 class="rounded-full px-6 py-3 text-sm font-semibold transition-colors" [class]="cls">{{ b.label }}</a>
            } @else {
              <a [routerLink]="b.route"
                 class="rounded-full px-6 py-3 text-sm font-semibold transition-colors" [class]="cls">{{ b.label }}</a>
            }
          }
        </div>
      </div>
    </section>
  `,
})
export class MarketingCtaComponent {
  readonly heading = input.required<string>();
  readonly blurb = input.required<string>();
  readonly buttons = input.required<CtaButton[]>();
}
