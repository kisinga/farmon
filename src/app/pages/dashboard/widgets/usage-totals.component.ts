import { Component, computed, input, signal } from '@angular/core';
import { findRoute, rollupUsageByEndpoint, formatDurationS, formatLitres, type DashboardSpec, type ResolvedEndpoint } from '@core';
import { SpanSelectorComponent } from './span-selector.component';
import type { UsageRun } from '../../../core/models/runtime';

/**
 * Timeframe water-usage totals — restores the "Used · period" counter that was
 * removed with the lossy client-side flow integral (0c51784), now sourced from the
 * durable runs ledger via the totals on each run record.
 *
 * Purely presentational: the dashboard store already loads ~30 days of completed
 * runs for the Activity feed, and the span control caps at 30d, so any sub-range is
 * derived here client-side (filter by started_at) with no extra fetch. Totals sum
 * the ledger's per-run figures (litres only from metered runs, never a phantom 0 L);
 * the per-endpoint breakdown uses the shared roll-up keyed on the endpoint node id
 * (capability owner), with the friendly name from the route control and a "shared"
 * flag when the endpoint's meter isn't cleanly attributable (possible double-count).
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
        @if (endpoints().length) {
          <ul class="mt-3 flex flex-col gap-1.5 border-t border-base-300/30 pt-3">
            @for (e of endpoints(); track e.endpointId) {
              <li class="flex items-center justify-between gap-2 text-xs">
                <span class="truncate text-base-content/70">{{ e.name }}</span>
                <span class="shrink-0 flex items-center gap-1.5 tabular-nums text-base-content/55">
                  @if (!e.attributable) {
                    <span class="text-warning/60" title="A shared meter feeds this endpoint, so the litres may double-count.">shared</span>
                  }
                  {{ e.meteredRuns > 0 ? fmtL(e.litres) : fmtD(e.duration_s) }}
                </span>
              </li>
            }
          </ul>
        }
      }
    </div>
  `,
})
export class UsageTotalsComponent {
  /** Completed runs (the store's ~30d ledger fetch). */
  readonly runs = input.required<UsageRun[]>();
  /** The dashboard spec, for resolving a run's (controller, route) -> endpoint. */
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

  protected endpoints = computed(() => {
    const spec = this.spec();
    // Resolve each (controller, route) once — findRoute is a linear scan.
    const cache = new Map<string, ResolvedEndpoint | undefined>();
    return rollupUsageByEndpoint(this.filtered(), (controller, route) => {
      const key = `${controller}:${route}`;
      if (cache.has(key)) return cache.get(key);
      const rc = findRoute(spec, controller, route);
      const ep: ResolvedEndpoint | undefined = rc?.caps
        ? { id: rc.caps.endpointId, name: rc.destination ?? rc.caps.endpointId, attributable: rc.caps.volumeAttributable }
        : undefined;
      cache.set(key, ep);
      return ep;
    }).slice(0, 5);
  });
}
