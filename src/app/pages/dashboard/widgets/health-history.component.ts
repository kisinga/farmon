import { Component, computed, effect, inject, input } from '@angular/core';
import { NgxEchartsDirective } from 'ngx-echarts';
import type { EChartsOption } from 'echarts';
import {
  HEAP_FREE_SENSOR, WIFI_SIGNAL_SENSOR, UPTIME_SENSOR, TEMP_SENSOR,
  BRAND, STATE_COLORS, UI_COLORS, NEUTRAL,
  type DashboardWidget,
} from '@core';
import type { TelemetryPoint } from '../../../core/models/runtime';
import {
  vitalsConnectivityOption,
  type MultiAxisSeries, type MultiAxisDef, type ConnectivityBand,
} from '../../../core/util/chart-theme';
import { DashboardStore } from '../dashboard.store';
import { TelemetryStore } from '../telemetry.store';
import { SpanSelectorComponent } from './span-selector.component';

/** A gap between consecutive samples wider than this reads as an offline stretch on
 *  the connectivity band. 2.5x the 5min rollup window: one missed window is jitter,
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

/** A duration in ms as a coarse "23m" / "1h 5m" — for the offline summary. */
function fmtDur(ms: number): string {
  const m = Math.round(ms / 60000);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60), mm = m % 60;
  return mm ? `${h}h ${mm}m` : `${h}h`;
}

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

/** Live-value chips: the three charted vitals plus uptime (the band's series). */
const VITAL_CHIPS: readonly { short: string; sensor: string; color: string; liveFmt: (raw: number) => string }[] = [
  ...CHART_METRICS.map((m) => ({ short: m.short, sensor: m.sensor, color: m.color, liveFmt: m.liveFmt })),
  { short: 'Up', sensor: UPTIME_SENSOR, color: NEUTRAL.slate400, liveFmt: fmtUptimeSeconds },
];

/** A telemetry point's numeric value across tiers (raw `value`, rollup `avg`). */
function pointValue(p: TelemetryPoint): number | null {
  const v = p.value ?? p.avg;
  return v == null || !Number.isFinite(v) ? null : v;
}

/** Reconstruct the connectivity band from an uptime series (sorted, epoch ms): each
 *  interval between consecutive samples is online when they're closer than
 *  {@link OFFLINE_GAP_MS} (else offline), merged into contiguous stretches; a drop in
 *  uptime marks a reboot. Spans only the sampled extent — the chart x-axis matches. */
function buildBand(pts: { t: number; v: number | null }[]): ConnectivityBand {
  if (pts.length === 0) return { segments: [], reboots: [] };
  const reboots: number[] = [];
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1].v, b = pts[i].v;
    if (a != null && b != null && b < a - 1) reboots.push(pts[i].t);
  }
  if (pts.length === 1) return { segments: [{ start: pts[0].t, end: pts[0].t, online: true }], reboots };
  const segments: ConnectivityBand['segments'] = [];
  for (let i = 1; i < pts.length; i++) {
    const online = pts[i].t - pts[i - 1].t <= OFFLINE_GAP_MS;
    const last = segments[segments.length - 1];
    if (last && last.online === online) last.end = pts[i].t;
    else segments.push({ start: pts[i - 1].t, end: pts[i].t, online });
  }
  return { segments, reboots };
}

/**
 * HealthHistoryComponent — per-controller device-health history for the dashboard's
 * reporting zone, reusing the same telemetry tiers as the flow/tank charts (a
 * 5min-rollup bulk + a short raw tail, stitched by TelemetryStore) via synthetic
 * `line` widgets, so it ships no firmware, server, or storage change.
 *
 * One ECharts chart per controller (see {@link vitalsConnectivityOption}): a multi-axis
 * vitals plot (free RAM / WiFi / temp, each in its own unit) above a connectivity band
 * (online green / offline red, reboot ticks) reconstructed from the uptime series. Both
 * share the time axis, so a single zoom ranges both and hovering one cross-hairs the
 * other — the band is part of the chart, not a separate element to keep in sync.
 *
 * Lazy: the page mounts it only when its section is first opened. Injects the runtime
 * stores directly (like ControllerHealthComponent) rather than threading the series
 * through the page template.
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

        @if (!chartLoaded(c.controller)) {
          <div class="h-72 flex items-center justify-center gap-2 text-base-content/30">
            <span class="loading loading-spinner loading-sm"></span><span class="text-xs">Loading…</span>
          </div>
        } @else if (chartHasData(c.controller)) {
          <div echarts [options]="chartOptions().get(c.controller)!" [autoResize]="true" class="h-72"></div>
          <!-- Band legend + summary (the band itself has no axis legend). -->
          <div class="flex items-center gap-x-3 gap-y-1 flex-wrap mt-1.5 text-[11px] text-base-content/45">
            <span class="inline-flex items-center gap-1.5"><span class="w-2.5 h-2 rounded-sm bg-success"></span>Online</span>
            <span class="inline-flex items-center gap-1.5"><span class="w-2.5 h-2 rounded-sm bg-error"></span>Offline</span>
            <span class="inline-flex items-center gap-1.5"><span class="inline-block w-0.5 h-3 bg-warning"></span>Reboot</span>
            <span class="grow"></span>
            @if (bandSummary(c.controller); as s) { <span class="truncate">{{ s }}</span> }
          </div>
        } @else {
          <div class="h-72 flex items-center justify-center"><span class="text-xs text-base-content/30">No vitals data in this window</span></div>
        }
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

  /** Per-controller connectivity band, from the uptime series only (no live clock), so
   *  it — and the chart option built from it — stay stable across live ticks (the chart
   *  doesn't reset its zoom every snapshot). */
  private bands = computed<Map<string, ConnectivityBand>>(() => {
    const out = new Map<string, ConnectivityBand>();
    for (const [controller, group] of this.widgetsByController()) {
      const pts = this.telemetry.seriesFor(group.uptime)
        .map((p) => ({ t: Date.parse(p.ts), v: pointValue(p) }))
        .filter((p) => Number.isFinite(p.t))
        .sort((a, b) => a.t - b.t);
      out.set(controller, buildBand(pts));
    }
    return out;
  });

  /** Per-controller chart options (vitals + connectivity band), rebuilt only when a
   *  series changes — not on every live tick — so the canvas keeps its zoom. */
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
      const band = this.bands().get(controller) ?? { segments: [], reboots: [] };
      out.set(controller, vitalsConnectivityOption(series, axes, band, rangeOf(series, band)));
    }
    return out;
  });

  // --- Load state ----------------------------------------------------------
  protected chartLoaded(controller: string): boolean {
    const w = this.allWidgets(controller);
    return w.length > 0 && w.every((x) => this.telemetry.loadedFor(x));
  }
  protected chartHasData(controller: string): boolean {
    return this.allWidgets(controller).some((x) => this.telemetry.seriesFor(x).length > 0);
  }

  /** "2 reboots · offline 23m" / "Online throughout" — caption under the chart. */
  protected bandSummary(controller: string): string {
    const b = this.bands().get(controller);
    if (!b || !b.segments.length) return '';
    const offline = b.segments.filter((s) => !s.online && !s.unknown).reduce((n, s) => n + (s.end - s.start), 0);
    const parts: string[] = [];
    if (b.reboots.length) parts.push(`${b.reboots.length} reboot${b.reboots.length === 1 ? '' : 's'}`);
    if (offline > 0) parts.push(`offline ${fmtDur(offline)}`);
    return parts.length ? parts.join(' · ') : 'Online throughout';
  }

  /** Current value chip from the live shadow; '—' when never reported, "offline" when
   *  the device is dark and silent. */
  protected liveText(controller: string, sensor: string, fmt: (raw: number) => string): string {
    const v = this.store.row(controller, sensor)?.reported;
    if (v == null || !Number.isFinite(v)) return this.store.presence(controller).online ? '—' : 'offline';
    return fmt(v);
  }

  /** The controller's remembered span (read off its uptime widget — `onSpan` keeps all
   *  series in lock-step). */
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

/** The time window spanning all vitals data + the band — pins both chart x-axes to one
 *  range so the grids align. Falls back to a zero window when there's nothing yet. */
function rangeOf(series: MultiAxisSeries[], band: ConnectivityBand): { from: number; to: number } {
  let from = Infinity, to = -Infinity;
  for (const s of series)
    for (const pt of s.data) {
      const t = typeof pt[0] === 'number' ? pt[0] : Date.parse(String(pt[0]));
      if (Number.isFinite(t)) { from = Math.min(from, t); to = Math.max(to, t); }
    }
  for (const seg of band.segments) { from = Math.min(from, seg.start); to = Math.max(to, seg.end); }
  return Number.isFinite(from) ? { from, to } : { from: 0, to: 0 };
}
