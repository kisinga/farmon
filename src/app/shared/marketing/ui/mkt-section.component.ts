import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

/**
 * The section shell every public page repeats: padding + centered container,
 * with an optional eyebrow / heading / subhead header block. Replaces the
 * `<section class="px-5 sm:px-8 py-16 …"><div class="max-w-5xl mx-auto">…`
 * wrapper that was copy-pasted a dozen times. Projected content follows the
 * header. `tint` paints the muted slate-50 band; `dark` is the slate-950 band.
 */
@Component({
  selector: 'mkt-section',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
  template: `
    <section [class]="sectionCls()">
      <div [class]="containerCls()">
        @if (eyebrow() || heading() || subhead()) {
          <div [class]="headerCls()">
            @if (eyebrow()) {
              <span [class]="eyebrowCls()">
                <span class="w-1.5 h-1.5 rounded-full" [class.bg-cyan-300]="dark()" [class.bg-cyan-700]="!dark()"></span>{{ eyebrow() }}
              </span>
            }
            @if (heading()) { <h2 class="mkt-h2">{{ heading() }}</h2> }
            @if (subhead()) { <p class="mkt-subhead mt-3" [class]="subheadColor()">{{ subhead() }}</p> }
          </div>
        }
        <ng-content />
      </div>
    </section>
  `,
})
export class MktSectionComponent {
  readonly eyebrow = input<string>();
  readonly heading = input<string>();
  readonly subhead = input<string>();
  readonly align = input<'center' | 'left'>('center');
  readonly tint = input(false);
  readonly dark = input(false);
  readonly width = input<'default' | 'wide' | 'narrow'>('default');

  protected readonly sectionCls = computed(() =>
    ['mkt-section', this.tint() ? 'bg-slate-50' : '', this.dark() ? 'relative overflow-hidden bg-slate-950 text-white' : '']
      .filter(Boolean).join(' '),
  );

  protected readonly containerCls = computed(() => {
    const w = this.width();
    const max = w === 'wide' ? 'max-w-6xl' : w === 'narrow' ? 'max-w-4xl' : 'max-w-5xl';
    return `${max} mx-auto relative`;
  });

  protected readonly headerCls = computed(() =>
    this.align() === 'center' ? 'text-center max-w-2xl mx-auto mb-10' : 'max-w-2xl mb-10',
  );

  protected readonly subheadColor = computed(() => (this.dark() ? 'text-white/60' : 'text-slate-600'));

  protected readonly eyebrowCls = computed(() =>
    this.dark()
      ? 'mkt-eyebrow mb-5'
      : 'inline-flex items-center gap-2 rounded-full bg-cyan-100 ring-1 ring-cyan-200 px-3 py-1 text-xs font-semibold text-cyan-800 mb-5',
  );
}
