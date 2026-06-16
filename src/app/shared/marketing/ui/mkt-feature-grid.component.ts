import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

/** A title + body cell in a feature grid. */
export interface MktFeatureItem {
  title: string;
  body: string;
}

/**
 * The title/body card grid that appears all over the public pages (conservation,
 * capabilities, verticals, every features group). Centralising it is what lets us
 * vary the grid intentionally instead of repeating one identical block. `cols`
 * sets the responsive column count; `tone` the card fill; `titleTone` the heading
 * colour; `interactive` adds the cyan hover ring.
 */
@Component({
  selector: 'mkt-feature-grid',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
  template: `
    <div [class]="gridCls()">
      @for (it of items(); track it.title) {
        <div [class]="cardCls()">
          <h3 class="font-semibold" [class]="titleCls()">{{ it.title }}</h3>
          <p class="mt-1.5 text-sm text-slate-600 leading-relaxed">{{ it.body }}</p>
        </div>
      }
    </div>
  `,
})
export class MktFeatureGridComponent {
  readonly items = input.required<MktFeatureItem[]>();
  readonly cols = input<2 | 3 | 4>(2);
  readonly tone = input<'light' | 'muted'>('light');
  readonly titleTone = input<'brand' | 'ink'>('ink');
  readonly interactive = input(false);

  protected readonly gridCls = computed(() =>
    this.cols() === 4 ? 'grid gap-5 sm:grid-cols-2 lg:grid-cols-4'
    : this.cols() === 3 ? 'grid gap-6 md:grid-cols-3'
    : 'grid gap-5 sm:grid-cols-2',
  );

  protected readonly cardCls = computed(() => {
    const base = this.tone() === 'muted'
      ? 'rounded-xl p-6 bg-slate-50 ring-1 ring-slate-200'
      : 'mkt-card';
    return this.interactive() ? `${base} hover:ring-cyan-300 transition-colors` : base;
  });

  protected readonly titleCls = computed(() => (this.titleTone() === 'brand' ? 'text-cyan-700' : 'text-slate-900'));
}
