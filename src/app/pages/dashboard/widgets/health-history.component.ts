import { Component, computed, effect, inject, input } from '@angular/core';
import { NgxEchartsDirective } from 'ngx-echarts';
import type { EChartsOption } from 'echarts';
import {
  HEAP_FREE_SENSOR, WIFI_SIGNAL_SENSOR, UPTIME_SENSOR, TEMP_SENSOR,
  BRAND, STATE_COLORS, UI_COLORS, NEUTRAL,
  type DashboardWidget,
} from '@core';
import type { TelemetryPoint } from '../../../core/models/runtime';
import { multiAxisHistoryOption, type MultiAxisSeries, type MultiAxisDef } from '../../../core/util/chart-theme';
import { DashboardStore } from '../dashboard.store';
import { TelemetryStore } from '../telemetry.store';
import { SpanSelectorComponent } from './span-selector.component';

/** A gap between consecutive samples wider than this reads as an offline stretch on
 *  the connectivity ribbon. 2.5x the 5min rollup window: one missed window is jitter,
 *  several in a row means the device wasn't reporting. Derived from data we already
 *  store (the absence of samples), not a logged disconnect event. */
const OFFLINE_GAP_MS = 12.5 * 60 * 1000;

/** A vitals series charted on its own axis (real units, no normalisation). `scale`
 *  maps the raw device reading to the axis's display unit (heap bytes -> KB); `fmt`
 *  formats that scaled value for the tooltip, `liveFmt` the raw shadow value for the
 *  current-value chip. */
interface ChartMetric {
  short: string;
  sensor: string;
  /** Legend/tooltip name — carries the unit, e.g. "RAM (KB)". */
  name: string;
  color: string;
  axisIndex: number;
  scale: number;
  fmt: (scaled: number) => string;
  liveFmt: (raw: number) => string;
  axis: Omit<MultiAxisDef, 'color'>;
}

/** Uptime (seconds) as a coarse "3d 4h" / "5h 12m" / "8m" for the live chip. */
function fmtUptimeSeconds(s: number): string {
  if (!Number.isFinite(s) || s < 0) return '—';
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

/** A duration in ms as a coarse "23m" / "1h 5m" — for offline-stretch labels. */
function fmtDur(ms: number): string {
  const m = Math.round(ms / 60000);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60), mm = m % 60;
  return mm ? `${h}h ${mm}m` : `${h}h`;
}

const fmtClock = (ms: number) => new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
const fmtStamp = (ms: number) => new Date(ms).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });

/** The three differently-united vitals sharing the combined chart: free RAM (KB, left
 *  axis), WiFi (dBm, right axis), SoC temp (°C, far-right axis). Already captured +
 *  rolled up server-side, so charting them adds no ingest/storage/firmware. Colours
 *  are canonical palette tokens. */
const CHART_METRICS: readonly ChartMetric[] = [
  {
    short: 'RAM', sensor: HEAP_FREE_SENSOR, name: 'RAM (KB)', color: BRAND.cyan, axisIndex: 0,
    scale: 1 / 1000, axis: { position: 'left', min: 0 },
    fmt: (v) => `${Math.round(v)} KB`, liveFmt: (v) => `${Math.round(v / 1000)} KB`,
  },
  {
    short: 'WiFi', sensor: WIFI_SIGNAL_SENSOR, name: 'WiFi (dBm)', color: STATE_COLORS.active, axisIndex: 1,
    scale: 1, axis: { position: 'right' },
    fmt: (v) => `${Math.round(v)} dBm`, liveFmt: (v) => `${Math.round(v)} dBm`,
  },
  {
    short: 'Temp', sensor: TEMP_SENSOR, name: 'Temp (°C)', color: UI_COLORS.warning, axisIndex: 2,
    scale: 1, axis: { position: 'right', offset: 44, formatter: '{value}°' },
    fmt: (v) => `${Math.round(v)} °C`, liveFmt: (v) => `${Math.round(v)} °C`,
  },
];

/** Live-value chips: the three charted vitals plus uptime (the ribbon's series). */
const VITAL_CHIPS: readonly { short: string; sensor: string; color: string; liveFmt: (raw: number) => string }[] = [
  ...CHART_METRICS.map((m) => ({ short: m.short, sensor: m.sensor, color: m.color, liveFmt: m.liveFmt })),
  { short: 'Up', sensor: UPTIME_SENSOR, color: NEUTRAL.slate400, liveFmt: fmtUptimeSeconds },
];

/** One stretch of the connectivity ribbon. */
interface RibbonSeg { start: number; end: number; online: boolean; unknown?: boolean }
/** A controller's connectivity over the chart window: contiguous online/offline
 *  stretches + reboot instants, all clamped to `[from, to]`. */
interface Ribbon { segments: RibbonSeg[]; reboots: number[]; from: number; to: number }

/** A telemetry point's numeric value across tiers (raw `value`, rollup `avg`). */
function pointValue(p: TelemetryPoint): number | null {
  const v = p.value ?? p.avg;
  return v == null || !Number.isFinite(v) ? null : v;
}

/** Reconstruct connectivity over `[from, to]` from an uptime series: merge samples
 *  closer than {@link OFFLINE_GAP_MS} into online runs, fill the gaps with offline,
 *  and mark reboots where uptime drops. Edges extend to the window bounds when the
 *  nearest sample is close enough (and, at the live edge, the device is online now). */
function buildRibbon(pts: { t: number; v: number | null }[], from: number, to: number, onlineNow: boolean): Ribbon {
  const reboots: number[] = [];
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1].v, b = pts[i].v;
    if (a != null && b != null && b < a - 1 && pts[i].t >= from && pts[i].t <= to) reboots.push(pts[i].t);
  }
  if (pts.length === 0) return { segments: [{ start: from, end: to, online: false, unknown: true }], reboots, from, to };

  const runs: [number, number][] = [];
  let s = pts[0].t, e = pts[0].t;
  for (let i = 1; i < pts.length; i++) {
    if (pts[i].t - pts[i - 1].t <= OFFLINE_GAP_MS) e = pts[i].t;
    else { runs.push([s, e]); s = pts[i].t; e = pts[i].t; }
  }
  runs.push([s, e]);
  if (runs[0][0] - from <= OFFLINE_GAP_MS) runs[0][0] = from;
  const last = runs[runs.length - 1];
  if (onlineNow && to - last[1] <= OFFLINE_GAP_MS) last[1] = to;

  const segments: RibbonSeg[] = [];
  let cursor = from;
  for (const [rs, re] of runs) {
    const a = Math.max(rs, from), b = Math.min(re, to);
    if (a > cursor) segments.push({ start: cursor, end: a, online: false });
    if (b > a) segments.push({ start: a, end: b, online: true });
    cursor = Math.max(cursor, b);
  }
  if (cursor < to) segments.push({ start: cursor, end: to, online: false });
  return { segments, reboots, from, to };
}

/**
 * HealthHistoryComponent — per-controller vitals history for the dashboard's
 * reporting zone, reusing the same telemetry tiers as the flow/tank charts (a
 * 5min-rollup bulk + a short raw tail, stitched by TelemetryStore) via synthetic
 * `line` widgets, so it ships no firmware, server, or storage change.
 *
 * Two visuals per controller:
 *  - a combined multi-axis line chart (free RAM / WiFi / temp, each in its own unit);
 *  - a connectivity ribbon — a continuous online/offline bar with reboot ticks,
 *    reconstructed from the uptime series (the offline-disconnect story, derived from
 *    sample gaps + uptime resets rather than a logged event).
 *
 * Lazy: the page mounts it only when its section is first opened, so its series load
 * on demand. Injects the runtime stores directly (like ControllerHealthComponent)
 * rather than threading the series through the page template.
 */
@Component({
  selector: 'app-health-history',
  standalone: true,
  imports: [NgxEchartsDirective, SpanSelectorComponent],
  host: { class: 'block' },
  template: `
    @for (c of store.spec().controllers; track c.controller) {
      <div class="mb-8 last:mb-0">
        <div class="flex items-center gap-2 mb-2">
          @if (showController()) {
            <span class="w-2 h-2 rounded-full shrink-0"
                  [class]="store.presence(c.controller).online ? 'bg-success' : 'bg-base-content/30'"
                  [title]="store.presence(c.controller).online ? 'Online' : 'Offline'"></span>
            <span class="text-xs font-semibold text-base-content/60">{{ c.name }}</span>
          }
          <span class="grow"></span>
          <app-span-selector [span]="span(c.controller)" (spanChange)="onSpan(c.controller, $event)" />
        </div>

        <!-- Current readings, colour-keyed to the chart lines. -->
        <div class="flex flex-wrap items-center gap-x-4 gap-y-1 mb-3">
          @for (chip of chips; track chip.sensor) {
            <span class="inline-flex items-center gap-1.5 text-[11px]">
              <span class="w-1.5 h-1.5 rounded-full shrink-0" [style.background-color]="chip.color"></span>
              <span class="text-base-content/45">{{ chip.short }}</span>
              <span class="font-semibold tabular-nums text-base-content/80">{{ liveText(c.controller, chip.sensor, chip.liveFmt) }}</span>
            </span>
          }
        </div>

        <!-- Combined vitals: three units, three axes, one time window. -->
        @if (!chartLoaded(c.controller)) {
          <div class="h-56 flex items-center justify-center gap-2 text-base-content/30">
            <span class="loading loading-spinner loading-sm"></span><span class="text-xs">Loading…</span>
          </div>
        } @else if (chartHasData(c.controller)) {
          <div echarts [options]="chartOptions().get(c.controller)!" [autoResize]="true" class="h-56"></div>
        } @else {
          <div class="h-56 flex items-center justify-center"><span class="text-xs text-base-content/30">No vitals data in this window</span></div>
        }

        <!-- Connectivity ribbon: continuous online/offline with reboot ticks. -->
        <div class="mt-4">
          <div class="flex items-center justify-between gap-2 mb-1.5">
            <span class="text-[11px] font-medium uppercase tracking-wide text-base-content/40">Connectivity</span>
            <span class="text-[11px] text-base-content/45 truncate">{{ ribbonSummary(c.controller) }}</span>
          </div>
          @if (!uptimeLoaded(c.controller)) {
            <div class="h-7 rounded-md bg-base-300/30 animate-pulse"></div>
          } @else if (ribbon(c.controller); as rb) {
            <div class="relative h-7 w-full rounded-md overflow-hidden bg-base-300/30 ring-1 ring-base-300/30">
              @for (seg of rb.segments; track seg.start) {
                <div class="absolute inset-y-0"
                     [class]="seg.online ? 'bg-success/80' : (seg.unknown ? '' : 'bg-base-content/15')"
                     [style.left.%]="pct(rb, seg.start)" [style.width.%]="widthPct(rb, seg.start, seg.end)"
                     [title]="segTitle(seg)"></div>
              }
              @for (t of rb.reboots; track t) {
                <div class="absolute inset-y-0 w-0.5 bg-warning" [style.left.%]="pct(rb, t)" [title]="'Reboot · ' + clock(t)"></div>
              }
            </div>
            <div class="flex items-center justify-between mt-1 text-[10px] text-base-content/35 tabular-nums">
              <span>{{ stamp(rb.from) }}</span>
              <span>now</span>
            </div>
          }
        </div>
      </div>
    }
  `,
})
export class HealthHistoryComponent {
  protected store = inject(DashboardStore);
  protected telemetry = inject(TelemetryStore);

  readonly siteId = input.required<string>();

  protected readonly chips = VITAL_CHIPS;
  /** Multi-controller sites label each block; a single controller doesn't need it
   *  (the page header already carries its online count). */
  protected showController = computed(() => this.store.spec().controllers.length > 1);

  /** Synthetic `line` widgets per controller — the three charted vitals plus uptime.
   *  Ids are `${controller}/${sensor}`, distinct from any real widget (health sensors
   *  are never charted as dashboard widgets), so they key TelemetryStore cleanly. */
  private widgetsByController = computed(() => {
    const m = new Map<string, { chart: { metric: ChartMetric; widget: DashboardWidget }[]; uptime: DashboardWidget }>();
    for (const c of this.store.spec().controllers) {
      const mk = (sensor: string, title: string): DashboardWidget =>
        ({ id: `${c.controller}/${sensor}`, kind: 'line', title, controller: c.controller, sensor });
      m.set(c.controller, {
        chart: CHART_METRICS.map((metric) => ({ metric, widget: mk(metric.sensor, metric.name) })),
        uptime: mk(UPTIME_SENSOR, 'Uptime'),
      });
    }
    return m;
  });
  private allWidgets(controller: string): DashboardWidget[] {
    const g = this.widgetsByController().get(controller);
    return g ? [...g.chart.map((x) => x.widget), g.uptime] : [];
  }

  /** Per-controller combined-chart options, rebuilt only when a series changes (not on
   *  every live tick) so the canvas doesn't needlessly re-render. */
  protected chartOptions = computed<Map<string, EChartsOption>>(() => {
    const out = new Map<string, EChartsOption>();
    const axes: MultiAxisDef[] = CHART_METRICS.map((m) => ({ ...m.axis, color: m.color }));
    for (const [controller, group] of this.widgetsByController()) {
      const series: MultiAxisSeries[] = group.chart.map(({ metric, widget }) => ({
        name: metric.name, color: metric.color, axisIndex: metric.axisIndex, fmt: metric.fmt,
        data: this.telemetry.seriesFor(widget).map((p) => {
          const raw = pointValue(p);
          return [p.ts, raw == null ? null : raw * metric.scale];
        }),
      }));
      out.set(controller, multiAxisHistoryOption(series, axes));
    }
    return out;
  });

  /** Per-controller connectivity ribbon. Reactive to the uptime series, the span, and
   *  the live clock (so the live edge advances) — but NOT the chart canvas. */
  private ribbons = computed<Map<string, Ribbon>>(() => {
    const out = new Map<string, Ribbon>();
    const now = this.store.now();
    for (const [controller, group] of this.widgetsByController()) {
      const to = now;
      const from = to - this.telemetry.spanFor(group.uptime) * 3_600_000;
      const pts = this.telemetry.seriesFor(group.uptime)
        .map((p) => ({ t: Date.parse(p.ts), v: pointValue(p) }))
        .filter((p) => Number.isFinite(p.t) && p.t <= to + 1000)
        .sort((a, b) => a.t - b.t);
      out.set(controller, buildRibbon(pts, from, to, this.store.presence(controller).online));
    }
    return out;
  });
  protected ribbon(controller: string): Ribbon | undefined { return this.ribbons().get(controller); }

  // --- Combined-chart load state ------------------------------------------
  protected chartLoaded(controller: string): boolean {
    const g = this.widgetsByController().get(controller);
    return !!g && g.chart.every((x) => this.telemetry.loadedFor(x.widget));
  }
  protected chartHasData(controller: string): boolean {
    const g = this.widgetsByController().get(controller);
    return !!g && g.chart.some((x) => this.telemetry.seriesFor(x.widget).length > 0);
  }
  protected uptimeLoaded(controller: string): boolean {
    const g = this.widgetsByController().get(controller);
    return !!g && this.telemetry.loadedFor(g.uptime);
  }

  // --- Ribbon geometry + labels -------------------------------------------
  protected pct(rb: Ribbon, t: number): number {
    const span = rb.to - rb.from;
    return span <= 0 ? 0 : Math.max(0, Math.min(100, ((t - rb.from) / span) * 100));
  }
  protected widthPct(rb: Ribbon, a: number, b: number): number {
    const span = rb.to - rb.from;
    return span <= 0 ? 0 : Math.max(0, Math.min(100, ((b - a) / span) * 100));
  }
  protected segTitle(seg: RibbonSeg): string {
    if (seg.unknown) return 'No connectivity data in this window';
    return seg.online
      ? `Online ${fmtClock(seg.start)}–${fmtClock(seg.end)}`
      : `Offline ${fmtClock(seg.start)}–${fmtClock(seg.end)} (${fmtDur(seg.end - seg.start)})`;
  }
  protected clock(t: number): string { return fmtClock(t); }
  protected stamp(t: number): string { return fmtStamp(t); }

  /** "2 reboots · offline 23m" / "Online the whole window" / "No connectivity data". */
  protected ribbonSummary(controller: string): string {
    const rb = this.ribbons().get(controller);
    if (!rb || rb.segments.every((s) => s.unknown)) return 'No connectivity data in this window';
    const offline = rb.segments.filter((s) => !s.online && !s.unknown).reduce((n, s) => n + (s.end - s.start), 0);
    const parts: string[] = [];
    if (rb.reboots.length) parts.push(`${rb.reboots.length} reboot${rb.reboots.length === 1 ? '' : 's'}`);
    if (offline > 0) parts.push(`offline ${fmtDur(offline)}`);
    return parts.length ? parts.join(' · ') : 'Online the whole window';
  }

  /** Current value chip from the live shadow; '—' when never reported, "offline" when
   *  the device is dark and silent. */
  protected liveText(controller: string, sensor: string, fmt: (raw: number) => string): string {
    const v = this.store.row(controller, sensor)?.reported;
    if (v == null || !Number.isFinite(v)) return this.store.presence(controller).online ? '—' : 'offline';
    return fmt(v);
  }

  /** The controller's remembered span (read off its uptime widget — `onSpan` keeps all
   *  four in lock-step). */
  protected span(controller: string): number {
    const g = this.widgetsByController().get(controller);
    return g ? this.telemetry.spanFor(g.uptime) : 6;
  }
  /** Re-range all of a controller's series together. */
  protected onSpan(controller: string, hours: number): void {
    for (const w of this.allWidgets(controller)) void this.telemetry.setSpan(this.siteId(), w, hours);
  }

  /** Widget ids already fetched, so the spec-reactive effect doesn't refetch. */
  private requested = new Set<string>();

  constructor() {
    // Backfill each series once the spec is in. The component is only mounted when its
    // section is open (the page gates it), so this fetches on demand; reactive to the
    // spec, so a controller that loads later still gets pulled.
    effect(() => {
      const site = this.siteId();
      if (!site) return;
      for (const c of this.store.spec().controllers)
        for (const w of this.allWidgets(c.controller))
          if (!this.requested.has(w.id)) {
            this.requested.add(w.id);
            void this.telemetry.load(site, w);
          }
    });
  }
}
