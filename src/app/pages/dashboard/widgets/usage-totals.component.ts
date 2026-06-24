import { Component, computed, input, signal } from '@angular/core';
import { rollupUsageByRoute, formatDurationS, formatLitres, findRoute, routeLabel, type DashboardSpec } from '@core';
import { SpanSelectorComponent } from './span-selector.component';
import { SPAN_PRESETS } from '../telemetry.store';
import type { UsageRun } from '../../../core/models/runtime';

/** Most route rows to list; the rest collapse off the bottom (sorted busiest-first). */
const MAX_ROUTE_ROWS = 8;
/** Hours of run history the store loads (its ~30d ledger). A comparison window needs
 *  the prior equal-length span to be fully inside this, else there's no baseline. */
const LOADED_WINDOW_HOURS = 24 * 30;

interface WindowTotals {
  count: number;
  litres: number;
  duration: number;
  /** Runs that carried a delivered-volume reading (drives litres-vs-time lead). */
  metered: number;
}

/** Sum a set of runs into one window total. Litres count metered runs only, never a
 *  phantom 0 L for an unmetered (time-only) run. */
function sumRuns(runs: readonly UsageRun[]): WindowTotals {
  let litres = 0;
  let duration = 0;
  let metered = 0;
  for (const r of runs) {
    duration += Number.isFinite(r.duration_s) ? r.duration_s : 0;
    if (r.metered && r.delivered_l != null) {
      litres += r.delivered_l;
      metered++;
    }
  }
  return { count: runs.length, litres, duration, metered };
}

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
 *
 * One presentation aid on top of the raw figures: a vs-previous-window delta, so the
 * headline number is judgeable ("656 L" alone can't be read as high or low) —
 * neutral-coloured, since more/less water carries no inherent good/bad valence, only
 * a "looks normal?" signal.
 *
 * Row membership is every route seen in the loaded ledger, not just the selected
 * window, so a route doesn't disappear (and the card doesn't reflow) when the chosen
 * span happens to contain no run on it — idle routes simply render dimmed at 0.
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
          @if (delta(); as d) {
            <span
              class="ml-auto inline-flex items-center gap-0.5 rounded-full bg-base-300/40 px-1.5 py-0.5 text-[0.7rem] font-medium tabular-nums text-base-content/55"
              [title]="'vs previous ' + spanLabel()">
              {{ d.dir === 'up' ? '↑' : d.dir === 'down' ? '↓' : '±' }}{{ d.magnitude }}%
            </span>
          }
        </div>
        <ul class="mt-3 flex flex-col divide-y divide-base-300/20 border-t border-base-300/30">
          @for (r of routes(); track r.controller + ':' + r.route) {
            <li class="flex items-center justify-between gap-3 py-2 text-xs" [class.opacity-40]="r.runs === 0">
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

  /** Label shown in the delta tooltip ("vs previous 24h"). */
  protected spanLabel = computed(
    () => SPAN_PRESETS.find((p) => p.hours === this.span())?.label ?? `${this.span()}h`,
  );

  /** Runs inside the selected window. */
  private filtered = computed(() => this.runsBetween(Date.now() - this.span() * 3_600_000, Infinity));

  /** Runs inside the immediately-preceding equal-length window (the comparison base). */
  private prevFiltered = computed(() => {
    const ms = this.span() * 3_600_000;
    const curStart = Date.now() - ms;
    return this.runsBetween(curStart - ms, curStart);
  });

  /** Runs with a placeable device clock whose start falls in [from, to). A run with no
   *  trusted clock (started_at === '') can't be windowed, so it's excluded — totals
   *  then under-count for that device. */
  private runsBetween(from: number, to: number): UsageRun[] {
    return this.runs().filter((r) => {
      const t = Date.parse(r.started_at);
      return Number.isFinite(t) && t >= from && t < to;
    });
  }

  protected totals = computed(() => sumRuns(this.filtered()));
  private prevTotals = computed(() => sumRuns(this.prevFiltered()));

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

  /** Percent change of this window's lead metric vs the prior equal window. Null when
   *  uncomparable: the prior window isn't fully loaded (span ≥ half the ledger), there
   *  was no prior baseline, or the two windows lead on different metrics (one metered,
   *  one not — litres-vs-time would be nonsense). */
  protected delta = computed(() => {
    if (this.span() * 2 > LOADED_WINDOW_HOURS) return null;
    const cur = this.totals();
    const prev = this.prevTotals();
    let a: number;
    let b: number;
    if (cur.metered > 0 && prev.metered > 0) { a = cur.litres; b = prev.litres; }
    else if (cur.metered === 0 && prev.metered === 0) { a = cur.duration; b = prev.duration; }
    else return null;
    if (b <= 0) return null;
    const pct = Math.round(((a - b) / b) * 100);
    return { magnitude: Math.abs(pct), dir: pct > 0 ? 'up' : pct < 0 ? 'down' : 'flat' } as const;
  });

  /** Per-route rows (busiest first, top {@link MAX_ROUTE_ROWS}). Membership is every
   *  route in the loaded ledger so the list is stable across span changes; figures are
   *  for the selected window. Idle-in-window routes carry 0 and render dimmed. */
  protected routes = computed(() => {
    const spec = this.spec();
    const label = (controller: string, route: number) =>
      routeLabel(findRoute(spec, controller, route), route);

    const windowed = new Map(
      rollupUsageByRoute(this.filtered(), label).map((r) => [`${r.controller}:${r.route}`, r]),
    );

    return rollupUsageByRoute(this.runs(), label)
      .map((base) => {
        const w = windowed.get(`${base.controller}:${base.route}`);
        return {
          ...base,
          litres: w?.litres ?? 0,
          duration_s: w?.duration_s ?? 0,
          runs: w?.runs ?? 0,
          meteredRuns: w?.meteredRuns ?? 0,
        };
      })
      .sort((a, b) => b.litres - a.litres || b.duration_s - a.duration_s || a.name.localeCompare(b.name))
      .slice(0, MAX_ROUTE_ROWS);
  });
}
