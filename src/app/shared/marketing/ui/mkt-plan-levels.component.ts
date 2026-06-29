import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { KIT_TIERS, PRICING, kes, type KitTier } from '../../../pages/pricing/pricing.model';

/**
 * The three kit tiers (Lite / Pro / Enterprise) shown identically on the landing card
 * and the /pricing page so the two never drift. Reads KIT_TIERS from the pricing model
 * (the single edit point). Each card carries a one-time price and what it contains.
 *
 * The monthly subscription is a single flat fee per site (constant), so it is a quiet
 * footnote here, not a per-card price: the kits carry the headline.
 *
 * `compact` tightens the cards for the landing summary.
 */
@Component({
  selector: 'mkt-plan-levels',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
  template: `
    <div class="grid gap-5 md:grid-cols-3 items-start">
      @for (k of kits; track k.name) {
        <div [class]="cardCls(k)">
          @if (k.featured) {
            <span class="inline-block mb-3 rounded-full bg-cyan-500/15 px-2.5 py-0.5 text-[11px] font-semibold text-cyan-700">Most popular</span>
          }
          <h3 class="text-lg font-bold text-slate-900">{{ k.name }}</h3>
          <p class="mt-1 text-sm text-slate-600 leading-relaxed">{{ k.tagline }}</p>

          <!-- One-time kit price -->
          <div class="mt-4 pt-4 border-t border-slate-100">
            <p class="flex items-baseline gap-1.5">
              <span class="text-2xl font-bold tabular-nums text-slate-900">{{ priceLabel(k) }}</span>
              @if (k.price !== null) {
                <span class="text-xs text-slate-500">one-time</span>
              }
            </p>
          </div>

          <ul class="mt-4 space-y-2 text-sm">
            @for (c of k.contents; track c) {
              <li class="flex gap-2.5">
                <svg class="shrink-0 mt-0.5 text-cyan-500" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                <span class="text-slate-700">{{ c }}</span>
              </li>
            }
          </ul>
        </div>
      }
    </div>
    <p class="mt-5 text-center text-xs text-slate-500 leading-relaxed">
      Each kit includes MajiFlow Cloud free to start, then an optional {{ monthly }} per site. Works on-site without it.
    </p>
  `,
})
export class MktPlanLevelsComponent {
  /** Tighter cards for the landing summary; default is the roomier /pricing layout. */
  readonly compact = input(false);

  protected readonly kits = KIT_TIERS;
  /** The flat monthly per site, e.g. "KES 2,500". */
  protected readonly monthly = kes(PRICING.monthlyPerSite);

  /** One-time price label, or "Custom" for the talk-to-us tier. */
  protected priceLabel(k: KitTier): string {
    return k.price !== null ? kes(k.price) : 'Custom';
  }

  /** The featured kit is highlighted; the rest are plain. `compact` trims padding. */
  protected cardCls(k: KitTier): string {
    const pad = this.compact() ? 'p-5' : 'p-6 sm:p-7';
    const ring = k.featured ? 'ring-2 ring-cyan-400 shadow-md' : 'ring-1 ring-slate-200 shadow-sm';
    return `rounded-2xl bg-white ${ring} ${pad}`;
  }
}
