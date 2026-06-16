import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { RouterLink } from '@angular/router';

/** The button's visual role. `link` is a plain text link (no pill). */
export type MktButtonVariant = 'primary' | 'ghost' | 'solid-light' | 'link';

/**
 * The one marketing button. Every primary action across the public pages renders
 * through this so the call-to-action is visually identical site-wide. Picks an
 * internal `routerLink` or an external `href` (new tab) from its inputs; the look
 * comes from the `.mkt-btn*` recipes in styles.css.
 */
@Component({
  selector: 'mkt-button',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink],
  host: { class: 'contents' },
  template: `
    @if (href()) {
      <a [href]="href()" target="_blank" rel="noopener" [class]="cls()"><ng-content /></a>
    } @else {
      <a [routerLink]="route()" [class]="cls()"><ng-content /></a>
    }
  `,
})
export class MktButtonComponent {
  readonly variant = input<MktButtonVariant>('primary');
  readonly route = input<string>();
  readonly href = input<string>();
  readonly size = input<'md' | 'sm'>('md');

  protected readonly cls = computed(() => {
    const v = this.variant();
    if (v === 'link') {
      return 'inline-flex items-center gap-1 text-sm font-semibold text-cyan-600 hover:text-cyan-700 transition-colors';
    }
    const variantCls =
      v === 'primary' ? 'mkt-btn-primary'
      : v === 'ghost' ? 'mkt-btn-ghost'
      : 'bg-white text-slate-900 hover:bg-slate-100'; // solid-light
    const size = this.size() === 'sm' ? 'px-5 py-2.5' : ''; // override .mkt-btn px-6 py-3
    return ['mkt-btn', variantCls, size].filter(Boolean).join(' ');
  });
}
