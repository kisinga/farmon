import { Component, computed, input, signal } from '@angular/core';
import { NgxEchartsDirective } from 'ngx-echarts';
import type { EChartsOption } from 'echarts';
import { formatDurationS, formatLitres, findRoute, routeLabel, type DashboardSpec } from '@core';
import { SpanSelectorComponent } from './span-selector.component';
import { SPAN_PRESETS } from '../telemetry.store';
import { CHART } from '../../../core/util/chart-theme';
import { CONTROLLER_PALETTE } from '../../../core/util/site-colors';
import type { UsageRun } from '../../../core/models/runtime';

/** Distinct route series before the tail folds into one "Other" bar (palette size). */
const MAX_SERIES = CONTROLLER_PALETTE.length;
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

/** Bucket width for a span, chosen so the bar count stays readable across the card's
 *  full width: sub-day spans bucket by 30 min / 2 h, multi-day spans by the day. */
function bucketMsFor(spanHours: number): number {
  if (spanHours <= 6) return 30 * 60_000;
  if (spanHours <= 24) return 2 * 3_600_000;
  return 24 * 3_600_000;
}

/** Axis label for a bucket start: clock time intraday, calendar day for daily buckets. */
function bucketLabel(t: Date, intraday: boolean): string {
  return intraday
    ? t.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false })
    : t.toLocaleDateString([], { day: 'numeric', month: 'short' });
}

/**
 * Water-usage summary over a duration — sourced from the durable runs ledger (restores
 * the counter dropped with the lossy client-side flow integral, 0c51784).
 *
 * Purely presentational: the dashboard store already loads ~30 days of completed runs
 * and the span control caps at 30d, so any sub-range is derived here client-side
 * (filter by started_at) with no extra fetch.
 *
 * The body is a time-bucketed stacked bar — delivered volume per bucket, one stacked
 * series per route — so an operator reads how much moved, when, and via which route in
 * a single glance (the route mix is the usual story: one route tends to dominate). A
 * headline total plus a vs-previous-window delta sit above it so the figure is
 * judgeable ("656 L" alone can't be read as high or low). Litres lead whenever any run
 * was metered; an all-unmetered window charts run time instead (never a phantom 0 L).
 */
@Component({
  selector: 'app-usage-totals',
  standalone: true,
  imports: [SpanSelectorComponent, NgxEchartsDirective],
  template: `
    <div class="rounded-xl border border-base-300/40 bg-base-100 p-4">
      <div class="flex items-center justify-between gap-2">
        <h3 class="text-sm font-semibold text-base-content/70">Water used</h3>
        <app-span-selector [span]="span()" (spanChange)="span.set($event)" />
      </div>

      @if (totals().count === 0) {
        <p class="py-10 text-center text-xs text-base-content/40">No runs in this period.</p>
      } @else {
        <div class="mt-3 flex items-end justify-between gap-3">
          <div class="flex items-baseline gap-1.5">
            <span class="text-2xl font-bold tabular-nums tracking-tight">{{ hero().value }}</span>
            <span class="text-sm font-medium text-base-content/45">{{ hero().unit }}</span>
            <span class="ml-1.5 text-xs text-base-content/45">{{ secondary() }}</span>
          </div>
          @if (delta(); as d) {
            <span
              class="inline-flex shrink-0 items-center gap-0.5 rounded-full bg-base-200/70 px-2 py-0.5 text-[0.7rem] font-medium tabular-nums text-base-content/55"
              [title]="'vs previous ' + spanLabel()">
              {{ d.dir === 'up' ? '↑' : d.dir === 'down' ? '↓' : '±' }}{{ d.magnitude }}%
            </span>
          }
        </div>

        <div echarts [options]="chart()" [autoResize]="true" class="mt-2 h-52 w-full"></div>
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
  private headline = computed(() => {
    const t = this.totals();
    return t.metered > 0 ? formatLitres(t.litres) : formatDurationS(t.duration);
  });

  /** Headline split into figure + unit so the unit sits muted next to the number
   *  ("684" + "L", "55" + "min"). Falls back to the whole string if it doesn't parse. */
  protected hero = computed(() => {
    const m = /^([\d.,]+)\s*(.*)$/.exec(this.headline());
    return m ? { value: m[1], unit: m[2] } : { value: this.headline(), unit: '' };
  });

  protected secondary = computed(() => {
    const t = this.totals();
    const runs = `${t.count} run${t.count === 1 ? '' : 's'}`;
    return t.metered > 0 ? `· ${runs} · ${formatDurationS(t.duration)}` : `· ${runs}`;
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

  /** Time-bucketed, route-stacked bar option for the window. Volume (litres) per bucket
   *  when metered, run minutes otherwise; routes past {@link MAX_SERIES} fold into one
   *  "Other" bar so the legend stays legible. */
  protected chart = computed<EChartsOption>(() => {
    const spec = this.spec();
    const runs = this.filtered();
    const useLitres = this.totals().metered > 0;
    const unit = useLitres ? 'L' : 'min';
    const valOf = (r: UsageRun): number =>
      useLitres
        ? (r.metered && r.delivered_l != null ? r.delivered_l : 0)
        : (Number.isFinite(r.duration_s) ? r.duration_s / 60 : 0);

    // Buckets spanning [now - span, now], one bar each.
    const bucketMs = bucketMsFor(this.span());
    const spanMs = this.span() * 3_600_000;
    const start = Date.now() - spanMs;
    const n = Math.max(1, Math.ceil(spanMs / bucketMs));
    const intraday = bucketMs < 24 * 3_600_000;
    const labels = Array.from({ length: n }, (_, i) => bucketLabel(new Date(start + i * bucketMs), intraday));

    // Rank routes by their window total, keep the top few, fold the rest into "Other".
    const label = (controller: string, route: number) => routeLabel(findRoute(spec, controller, route), route);
    const byRoute = new Map<string, { name: string; total: number }>();
    for (const r of runs) {
      const key = `${r.controller}:${r.route}`;
      const e = byRoute.get(key) ?? { name: label(r.controller, r.route), total: 0 };
      e.total += valOf(r);
      byRoute.set(key, e);
    }
    const ranked = [...byRoute.entries()].sort((a, b) => b[1].total - a[1].total);
    const topKeys = ranked.slice(0, MAX_SERIES).map(([k]) => k);
    const isTop = new Set(topKeys);
    const hasOther = ranked.length > MAX_SERIES;

    const bucketsByKey = new Map<string, number[]>();
    for (const k of topKeys) bucketsByKey.set(k, new Array(n).fill(0));
    if (hasOther) bucketsByKey.set('__other', new Array(n).fill(0));

    for (const r of runs) {
      const t = Date.parse(r.started_at);
      if (!Number.isFinite(t)) continue;
      const bi = Math.min(n - 1, Math.max(0, Math.floor((t - start) / bucketMs)));
      const key = `${r.controller}:${r.route}`;
      const bucket = bucketsByKey.get(isTop.has(key) ? key : '__other');
      if (bucket) bucket[bi] += valOf(r);
    }

    const round = (v: number) => Math.round(v * 10) / 10;
    const series: EChartsOption['series'] = topKeys.map((k, i) => ({
      name: byRoute.get(k)!.name,
      type: 'bar',
      stack: 'usage',
      barMaxWidth: 28,
      data: bucketsByKey.get(k)!.map(round),
      itemStyle: { color: CONTROLLER_PALETTE[i % CONTROLLER_PALETTE.length] },
    }));
    if (hasOther) {
      series.push({
        name: 'Other',
        type: 'bar',
        stack: 'usage',
        barMaxWidth: 28,
        data: bucketsByKey.get('__other')!.map(round),
        itemStyle: { color: CHART.label },
      });
    }

    return {
      textStyle: { color: CHART.label },
      grid: { left: 38, right: 12, top: 10, bottom: 48 },
      tooltip: {
        trigger: 'axis',
        axisPointer: { type: 'shadow' },
        valueFormatter: (v) => (v ? `${v} ${unit}` : `0 ${unit}`),
      },
      legend: { bottom: 0, icon: 'circle', itemWidth: 8, itemHeight: 8, textStyle: { color: CHART.label, fontSize: 11 } },
      xAxis: {
        type: 'category',
        data: labels,
        axisLine: { lineStyle: { color: CHART.axis } },
        axisTick: { show: false },
        axisLabel: { color: CHART.label, hideOverlap: true },
      },
      yAxis: {
        type: 'value',
        axisLabel: { color: CHART.label },
        splitLine: { lineStyle: { color: CHART.axis } },
      },
      series,
    };
  });
}
