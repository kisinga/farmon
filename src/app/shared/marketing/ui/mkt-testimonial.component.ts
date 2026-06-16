import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

/**
 * One deliberate pull-quote — social proof that intentionally breaks the card-grid
 * rhythm rather than adding another grid. Self-contained section. NOTE: quote and
 * attribution are placeholders until a real customer quote is supplied.
 */
@Component({
  selector: 'mkt-testimonial',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
  template: `
    <section class="mkt-section bg-slate-50">
      <div class="max-w-4xl mx-auto text-center">
        <svg class="mx-auto mb-6 text-cyan-300" width="40" height="40" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <path d="M9.5 8C6.5 8 5 10.5 5 13.5c0 2.5 1.6 4.5 4 4.5 2.1 0 3.5-1.5 3.5-3.5S11 11 9 11c-.3 0-.6 0-.8.1.3-1 1.2-1.6 2.3-1.6V8zm9 0c-3 0-4.5 2.5-4.5 5.5 0 2.5 1.6 4.5 4 4.5 2.1 0 3.5-1.5 3.5-3.5S20 11 18 11c-.3 0-.6 0-.8.1.3-1 1.2-1.6 2.3-1.6V8z"/>
        </svg>
        <blockquote class="text-2xl sm:text-3xl font-medium leading-snug tracking-tight text-slate-900" style="font-family:var(--font-display)">
          "{{ quote() }}"
        </blockquote>
        <div class="mt-7 flex items-center justify-center gap-3">
          @if (avatar()) {
            <img [src]="avatar()" [alt]="author()" width="44" height="44" loading="lazy" decoding="async"
                 class="w-11 h-11 rounded-full object-cover ring-1 ring-slate-200" />
          } @else {
            <span class="w-11 h-11 rounded-full bg-cyan-100 text-cyan-700 font-semibold flex items-center justify-center">{{ initials() }}</span>
          }
          <div class="text-left">
            <div class="font-semibold text-slate-900">{{ author() }}</div>
            @if (role()) { <div class="text-sm text-slate-500">{{ role() }}</div> }
          </div>
        </div>
      </div>
    </section>
  `,
})
export class MktTestimonialComponent {
  readonly quote = input.required<string>();
  readonly author = input.required<string>();
  readonly role = input<string>();
  readonly avatar = input<string>();

  protected readonly initials = computed(() =>
    this.author().split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase(),
  );
}
