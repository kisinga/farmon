import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { KIT_TIERS, type KitTier } from '../../../pages/pricing/pricing.model';

/**
 * Deployment levels shown identically on the landing card and assessment page so the
 * two never drift. Reads KIT_TIERS from the pricing model (the single edit point), but
 * deliberately does not publish prices: serious sites are qualified and scoped first.
 *
 * `compact` tightens the cards for the landing summary.
 */
@Component({
  selector: 'mkt-plan-levels',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
  template: `
    <div [class]="gridCls">
      @for (k of kits; track k.name) {
        <div [class]="cardCls(k)">
          @if (k.featured) {
            <span class="inline-block mb-3 rounded-full bg-cyan-500/15 px-2.5 py-0.5 text-[11px] font-semibold text-cyan-700">Most popular</span>
          }
          <h3 class="text-lg font-bold text-slate-900">{{ k.name }}</h3>
          <p class="mt-1 text-sm text-slate-600 leading-relaxed">{{ k.tagline }}</p>

          <div class="mt-4 pt-4 border-t border-slate-100">
            <p class="text-sm font-semibold text-slate-900">{{ accessLabel(k) }}</p>
            <p class="mt-1 text-xs leading-relaxed text-slate-500">{{ accessNote(k) }}</p>
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
    @if (!compact()) {
      <p class="mt-5 text-center text-xs text-slate-500 leading-relaxed">
        Built for operators with real water risk: dry tanks, burnt pumps, unbilled usage, lost irrigation windows, or many people depending on supply.
      </p>
    }
  `,
})
export class MktPlanLevelsComponent {
  /** Tighter cards for the landing summary; default is the roomier /pricing layout. */
  readonly compact = input(false);

  /** Tiers shown publicly: `hidden` ones (e.g. Lite while we validate the premium end)
   *  stay in KIT_TIERS but are dropped here. Restore by clearing the flag on the tier. */
  protected readonly kits = KIT_TIERS.filter((k) => !k.hidden);

  /** Column count tracks the number of visible kits so two cards do not leave an empty
   *  third column (Tailwind needs whole static class strings, so we switch, not interpolate). */
  protected get gridCls(): string {
    const cols =
      this.kits.length >= 3
        ? 'md:grid-cols-3'
        : this.kits.length === 2
          ? 'md:grid-cols-2 md:max-w-3xl md:mx-auto'
          : 'md:grid-cols-1 md:max-w-md md:mx-auto';
    return `grid gap-5 ${cols} items-start`;
  }

  /** Public posture for the level. The actual price is scoped after fit + survey. */
  protected accessLabel(k: KitTier): string {
    return k.price === null ? 'Custom commercial scope' : 'Scoped after site assessment';
  }

  protected accessNote(k: KitTier): string {
    return k.price === null
      ? 'For multi-site, water-selling, SLA, or managed-service deployments.'
      : 'We confirm fit, field conditions, install path, and support level before quoting.';
  }

  /** The featured kit is highlighted; the rest are plain. `compact` trims padding. */
  protected cardCls(k: KitTier): string {
    const pad = this.compact() ? 'p-5' : 'p-6 sm:p-7';
    const ring = k.featured ? 'ring-2 ring-cyan-400 shadow-md' : 'ring-1 ring-slate-200 shadow-sm';
    return `rounded-2xl bg-white ${ring} ${pad}`;
  }
}
