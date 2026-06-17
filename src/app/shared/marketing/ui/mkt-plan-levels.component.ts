import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { PLAN_LEVELS, PRICING, kes } from '../../../pages/pricing/pricing.model';

/**
 * The three feature levels (Base / Scale / Enterprise) shown identically on the
 * landing card and the /pricing page so the two never drift. Reads its data from
 * PLAN_LEVELS in the pricing model (the single edit point).
 *
 * Each level is its own pricing group, so each card carries its own price: Base is the
 * standard per-controller rate, Scale is the volume-discounted rate that applies once a
 * site runs several controllers, and Enterprise is quoted. The numbers are derived from
 * PRICING.subscription, so they track the estimator automatically.
 *
 * Honesty rule, enforced here: a feature with `status: 'soon'` renders as a muted
 * "Soon" row, never as a checked, working feature. Nothing here gates anything;
 * this is presentation only (see entitlements.go for where enforcement will live).
 *
 * `compact` tightens the cards for the landing summary; the full page uses the
 * roomier default and the live estimator below carries the per-bracket detail.
 */
@Component({
  selector: 'mkt-plan-levels',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
  template: `
    <div class="grid gap-5 md:grid-cols-3 items-start">
      @for (lvl of levels; track lvl.name; let i = $index) {
        <div [class]="cardCls(i)">
          @if (i === 1) {
            <span class="inline-block mb-3 rounded-full bg-cyan-500/15 px-2.5 py-0.5 text-[11px] font-semibold text-cyan-700">Most sites grow here</span>
          }
          <h3 class="text-lg font-bold text-slate-900">{{ lvl.name }}</h3>
          <p class="mt-1 text-sm text-slate-600 leading-relaxed">{{ lvl.tagline }}</p>

          <!-- This level's own price -->
          <div class="mt-4 pt-4 border-t border-slate-100">
            <p class="flex items-baseline gap-1.5">
              <span class="text-2xl font-bold tabular-nums text-slate-900">{{ prices[i].amount }}</span>
              @if (prices[i].unit) {
                <span class="text-xs text-slate-500">{{ prices[i].unit }}</span>
              }
            </p>
            <p class="mt-1.5 text-xs text-slate-500 leading-relaxed">{{ prices[i].note }}</p>
          </div>

          <ul class="mt-4 space-y-2 text-sm">
            @for (f of lvl.features; track f.label) {
              <li class="flex gap-2.5" [class.opacity-60]="f.status === 'soon'">
                @if (f.status === 'live') {
                  <svg class="shrink-0 mt-0.5 text-cyan-500" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                  <span class="text-slate-700">{{ f.label }}</span>
                } @else {
                  <span class="shrink-0 mt-0.5 inline-flex items-center rounded-full bg-slate-100 px-1.5 text-[10px] font-semibold uppercase tracking-wide text-slate-500">Soon</span>
                  <span class="text-slate-500">{{ f.label }}</span>
                }
              </li>
            }
          </ul>
        </div>
      }
    </div>
    <p class="mt-5 text-center text-xs text-slate-500 leading-relaxed">
      Adding tanks, valves or flow to a controller never raises the monthly. Plus a one-time
      hardware kit, sold near cost.
    </p>
  `,
})
export class MktPlanLevelsComponent {
  /** Tighter cards for the landing summary; default is the roomier /pricing layout. */
  readonly compact = input(false);

  protected readonly levels = PLAN_LEVELS;

  /** Each level's own price, in its own group, derived from PRICING.subscription so it
   *  never drifts from the estimator. Index matches `levels` (Base / Scale / Enterprise). */
  protected readonly prices = (() => {
    const s = PRICING.subscription;
    const floor = kes(s[s.length - 1].rate);
    return [
      { amount: kes(s[0].rate), unit: '/ controller, monthly', note: 'For a single controller.' },
      { amount: kes(s[1].rate), unit: '/ controller, monthly', note: 'Once you run several. Down to ' + floor + ' each as you add more.' },
      { amount: 'Custom', unit: '', note: 'Priced to your operation. Talk to us.' },
    ];
  })();

  /** Middle card (Scale) is highlighted; the rest are plain. `compact` trims padding. */
  protected cardCls(i: number): string {
    const pad = this.compact() ? 'p-5' : 'p-6 sm:p-7';
    const ring = i === 1
      ? 'ring-2 ring-cyan-400 shadow-md'
      : 'ring-1 ring-slate-200 shadow-sm';
    return `rounded-2xl bg-white ${ring} ${pad}`;
  }
}
