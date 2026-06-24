import { Component, computed, input, signal } from '@angular/core';
import { rollupUsageByRoute, formatDurationS, formatLitres, findRoute, routeLabel, type DashboardSpec } from '@core';
import { SpanSelectorComponent } from './span-selector.component';
import type { UsageRun } from '../../../core/models/runtime';

/**
 * Per-route water-usage totals over a duration — restores the "Used · period"
 * counter that was removed with the lossy client-side flow integral (0c51784), now
 * sourced from the durable runs ledger.
 *
 * Purely presentational: the dashboard store already loads ~30 days of completed
 * runs, and the span control caps at 30d, so any sub-range is derived here
 * client-side (filter by started_at) with no extra fetch. Each row is one route's
 * total in the window (litres when metered, else time) so an operator sees which
 * route moved how much — two routes to the same endpoint (e.g. from different
 * sources) stay separate. Litres sum only metered runs (never a phantom 0 L).
 */
@Component({
  selector: 'app-usage-totals',
  standalone: true,
  imports: [SpanSelectorComponent],
  template: `
    <div class="rounded-xl border border-base-300/40 bg-base-100 p-4">
      <div class="flex items-center justify-between gap-2 mb-3">
        <h3 class="text-sm font-semibold text-base-content/70">Water used</h3>
        <app-span-selector [span]="span()" (spanChange)="span.set($event)" />
      </div>

      @if (totals().count === 0) {
        <p class="text-xs text-base-content/40 py-4 text-center">No runs in this period.</p>
      } @else {
        <div class="flex items-baseline gap-2 flex-wrap">
          <span class="text-2xl font-bold tabular-nums">{{ headline() }}</span>
          <span class="text-xs text-base-content/45">{{ secondary() }}</span>
        </div>
        <ul class="mt-3 flex flex-col gap-1.5 border-t border-base-300/30 pt-3">
          @for (r of routes(); track r.controller + ':' + r.route) {
            <li class="flex items-center justify-between gap-2 text-xs">
              <span class="truncate text-base-content/70">{{ r.name }}</span>
              <span class="shrink-0 tabular-nums text-base-content/55">
                {{ r.meteredRuns > 0 ? fmtL(r.litres) : fmtD(r.duration_s) }}
                <span class="text-base-content/35">· {{ r.runs }} run{{ r.runs === 1 ? '' : 's' }}</span>
              </span>
            </li>
          }
        </ul>
      }
    </div>
  `,
})
export class UsageTotalsComponent {
  /** Completed runs (the store's ~30d ledger fetch). */
  readonly runs = input.required<UsageRun[]>();
  /** The dashboard spec, for resolving a run's (controller, route) -> route label. */
  readonly spec = input.required<DashboardSpec>();

  /** Selected window in hours (default 7d). Capped at 30d by the span presets, which
   *  matches the store's run-fetch window, so every range is derivable client-side. */
  protected span = signal(24 * 7);

  protected fmtL = formatLitres;
  protected fmtD = formatDurationS;

  private filtered = computed(() => {
    const cutoff = Date.now() - this.span() * 3_600_000;
    return this.runs().filter((r) => {
      // A run with no trusted device clock (started_at === '') can't be placed in a
      // window, so it's excluded here — totals then under-count for that device.
      const t = Date.parse(r.started_at);
      return Number.isFinite(t) && t >= cutoff;
    });
  });

  protected totals = computed(() => {
    let litres = 0;
    let duration = 0;
    let metered = 0;
    for (const r of this.filtered()) {
      duration += Number.isFinite(r.duration_s) ? r.duration_s : 0;
      if (r.metered && r.delivered_l != null) { litres += r.delivered_l; metered++; }
    }
    return { count: this.filtered().length, litres, duration, metered };
  });

  /** Litres lead when any run was metered; otherwise time leads (so an all-unmetered
   *  period reads "1.2 h" rather than a misleading "0 L"). */
  protected headline = computed(() => {
    const t = this.totals();
    return t.metered > 0 ? this.fmtL(t.litres) : this.fmtD(t.duration);
  });

  protected secondary = computed(() => {
    const t = this.totals();
    const runs = `${t.count} run${t.count === 1 ? '' : 's'}`;
    return t.metered > 0 ? `${runs} · ${this.fmtD(t.duration)}` : runs;
  });

  /** Per-route totals for the window, top 8 by litres. */
  protected routes = computed(() => {
    const spec = this.spec();
    return rollupUsageByRoute(this.filtered(), (controller, route) =>
      routeLabel(findRoute(spec, controller, route), route),
    ).slice(0, 8);
  });
}
