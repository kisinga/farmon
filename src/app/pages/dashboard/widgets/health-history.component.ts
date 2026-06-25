import { Component, computed, effect, inject, input } from '@angular/core';
import { NgxEchartsDirective } from 'ngx-echarts';
import type { EChartsOption } from 'echarts';
import {
  HEAP_FREE_SENSOR, WIFI_SIGNAL_SENSOR, UPTIME_SENSOR, TEMP_SENSOR,
  type DashboardWidget,
} from '@core';
import type { TelemetryPoint } from '../../../core/models/runtime';
import { historyLineOption } from '../../../core/util/chart-theme';
import { DashboardStore } from '../dashboard.store';
import { TelemetryStore } from '../telemetry.store';
import { SpanSelectorComponent } from './span-selector.component';

/** A gap between consecutive samples wider than this reads as an offline stretch.
 *  2.5x the 5min rollup window: one missed window is just jitter, several in a row
 *  means the device wasn't reporting. Honest-but-coarse — it's derived from data we
 *  already store (the absence of samples), not a logged disconnect event. */
const OFFLINE_GAP_MS = 12.5 * 60 * 1000;

/** One charted vitals series. `scale` maps the raw device reading to the chart's
 *  display unit (heap bytes -> KB, uptime seconds -> hours); `chartTip` formats that
 *  scaled value for the tooltip, `liveFmt` formats the raw shadow value for the
 *  current-value chip. Each metric is one line chart — same encoding across the row. */
interface HealthMetric {
  key: string;
  sensor: string;
  title: string;
  iconPath: string;
  scale: number;
  axisFmt: string;
  yMin?: number;
  chartTip: (scaled: number) => string;
  liveFmt: (raw: number) => string;
  /** Uptime is the connectivity series: its sawtooth resets are reboots. */
  isUptime?: boolean;
}

/** Uptime (seconds) as a coarse "3d 4h" / "5h 12m" / "8m" for the live chip. */
function fmtUptimeSeconds(s: number): string {
  if (!Number.isFinite(s) || s < 0) return '—';
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

/** Uptime (hours, the charted unit) for the chart tooltip — days once it's long. */
function fmtUptimeHours(h: number): string {
  return h >= 48 ? `${(h / 24).toFixed(1)} d` : `${h.toFixed(1)} h`;
}

/** The four cheap-to-chart vitals already captured + rolled up server-side. WiFi /
 *  RAM / temp / uptime are plain numeric series in the same telemetry tiers the
 *  flow + tank charts read, so this adds no ingest, storage, or firmware. */
const HEALTH_METRICS: readonly HealthMetric[] = [
  {
    key: 'wifi', sensor: WIFI_SIGNAL_SENSOR, title: 'WiFi signal',
    iconPath: 'M8.288 15.038a5.25 5.25 0 017.424 0M5.106 11.856c3.807-3.808 9.98-3.808 13.788 0M1.924 8.674c5.565-5.565 14.587-5.565 20.152 0M12.53 18.22l-.53.53-.53-.53a.75.75 0 011.06 0z',
    scale: 1, axisFmt: '{value}', yMin: undefined,
    chartTip: (v) => `${Math.round(v)} dBm`, liveFmt: (v) => `${Math.round(v)} dBm`,
  },
  {
    key: 'ram', sensor: HEAP_FREE_SENSOR, title: 'Free RAM',
    iconPath: 'M8.25 3v1.5M4.5 8.25H3m18 0h-1.5M4.5 12H3m18 0h-1.5m-15 3.75H3m18 0h-1.5M8.25 19.5V21M12 3v1.5m0 15V21m3.75-18v1.5m0 15V21m-9-1.5h10.5a2.25 2.25 0 002.25-2.25V6.75a2.25 2.25 0 00-2.25-2.25H6.75A2.25 2.25 0 004.5 6.75v10.5a2.25 2.25 0 002.25 2.25zm.75-12h9v9h-9v-9z',
    scale: 1 / 1000, axisFmt: '{value}', yMin: 0,
    chartTip: (v) => `${Math.round(v)} KB`, liveFmt: (v) => `${Math.round(v / 1000)} KB`,
  },
  {
    key: 'temp', sensor: TEMP_SENSOR, title: 'Temperature',
    iconPath: 'M14 14.76V3.5a2.5 2.5 0 00-5 0v11.26a4.5 4.5 0 105 0z',
    scale: 1, axisFmt: '{value}°',
    chartTip: (v) => `${Math.round(v)} °C`, liveFmt: (v) => `${Math.round(v)} °C`,
  },
  {
    key: 'uptime', sensor: UPTIME_SENSOR, title: 'Uptime', isUptime: true,
    iconPath: 'M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z',
    scale: 1 / 3600, axisFmt: '{value}h', yMin: 0,
    chartTip: fmtUptimeHours, liveFmt: fmtUptimeSeconds,
  },
];

/** A telemetry point's numeric value across tiers (raw `value`, rollup `avg`). */
function pointValue(p: TelemetryPoint): number | null {
  const v = p.value ?? p.avg;
  return v == null || !Number.isFinite(v) ? null : v;
}

/** Build the shared history-line option for one metric's series (scaled to its
 *  display unit). Kept module-level so the `computed` produces stable references. */
function buildOption(m: HealthMetric, series: TelemetryPoint[]): EChartsOption {
  const data = series.map((p) => {
    const raw = pointValue(p);
    return [p.ts, raw == null ? null : raw * m.scale];
  });
  return historyLineOption(data, {
    yMin: m.yMin,
    yAxisFormatter: m.axisFmt,
    tooltipValueFormatter: (v) => m.chartTip(Number(v)),
  });
}

/**
 * HealthHistoryComponent — per-controller vitals history (WiFi / RAM / temp /
 * uptime) for the dashboard's reporting zone. It reads the SAME telemetry tiers as
 * the flow/tank charts (a 5min-rollup bulk + a short raw tail, stitched by
 * TelemetryStore) via synthetic `line` widgets, so it ships no firmware, server, or
 * storage change — the series already exist. Each metric is one line chart; the
 * uptime chart is also the connectivity view (a drop to zero is a reboot, a flat gap
 * is an offline stretch), summarised as "N restarts · M offline gaps".
 *
 * Lazy: loads only once its section is first opened (`active`). Injects the runtime
 * stores directly (like ControllerHealthComponent) rather than threading 4 series x N
 * controllers through the page template.
 */
@Component({
  selector: 'app-health-history',
  standalone: true,
  imports: [NgxEchartsDirective, SpanSelectorComponent],
  host: { class: 'block' },
  template: `
    @if (active()) {
      @for (c of store.spec().controllers; track c.controller) {
        <div class="mb-6 last:mb-0">
          <div class="flex items-center gap-2 mb-3">
            @if (showController()) {
              <span class="w-2 h-2 rounded-full shrink-0"
                    [class]="store.presence(c.controller).online ? 'bg-success' : 'bg-base-content/30'"
                    [title]="store.presence(c.controller).online ? 'Online' : 'Offline'"></span>
              <span class="text-xs font-semibold text-base-content/60">{{ c.name }}</span>
            }
            <span class="grow"></span>
            <app-span-selector [span]="span(c.controller)" (spanChange)="onSpan(c.controller, $event)" />
          </div>

          <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
            @for (w of widgets(c.controller); track w.widget.id) {
              <div class="rounded-box bg-base-200/30 ring-1 ring-base-300/30 p-3">
                <div class="flex items-center gap-2 mb-2">
                  <svg xmlns="http://www.w3.org/2000/svg" class="h-3.5 w-3.5 shrink-0 text-base-content/40" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.6">
                    <path stroke-linecap="round" stroke-linejoin="round" [attr.d]="w.metric.iconPath" />
                  </svg>
                  <span class="text-xs font-medium text-base-content/70">{{ w.metric.title }}</span>
                  <span class="grow"></span>
                  <span class="text-xs font-semibold tabular-nums text-base-content/80">{{ liveText(c.controller, w.metric) }}</span>
                </div>

                @if (!telemetry.loadedFor(w.widget)) {
                  <div class="h-40 flex items-center justify-center gap-2 text-base-content/30">
                    <span class="loading loading-spinner loading-sm"></span><span class="text-xs">Loading…</span>
                  </div>
                } @else if (hasData(w.widget)) {
                  <div echarts [options]="chartOptions().get(w.widget.id)!" [autoResize]="true" class="h-40"></div>
                  @if (w.metric.isUptime) {
                    <p class="text-[11px] text-base-content/40 text-center mt-1">{{ connectivityText(c.controller) }}</p>
                  }
                } @else {
                  <div class="h-40 flex items-center justify-center"><span class="text-xs text-base-content/30">No data in this window</span></div>
                }
              </div>
            }
          </div>
        </div>
      }
    }
  `,
})
export class HealthHistoryComponent {
  protected store = inject(DashboardStore);
  protected telemetry = inject(TelemetryStore);

  readonly siteId = input.required<string>();
  /** Section opened — gate the lazy load + chart instantiation on this. */
  readonly active = input(false);

  protected readonly metrics = HEALTH_METRICS;
  /** Multi-controller sites label each block; a single controller doesn't need it
   *  (the page header already carries its online count). */
  protected showController = computed(() => this.store.spec().controllers.length > 1);

  /** Synthetic `line` widgets per controller — one per vitals metric. Their ids are
   *  `${controller}/${sensor}`, distinct from any real widget (health sensors are
   *  never charted as dashboard widgets), so they key TelemetryStore cleanly. */
  private widgetsByController = computed(() => {
    const m = new Map<string, { metric: HealthMetric; widget: DashboardWidget }[]>();
    for (const c of this.store.spec().controllers) {
      m.set(c.controller, HEALTH_METRICS.map((metric) => ({
        metric,
        widget: { id: `${c.controller}/${metric.sensor}`, kind: 'line', title: metric.title, controller: c.controller, sensor: metric.sensor } as DashboardWidget,
      })));
    }
    return m;
  });
  protected widgets(controller: string): { metric: HealthMetric; widget: DashboardWidget }[] {
    return this.widgetsByController().get(controller) ?? [];
  }

  /** Per-metric ECharts options, rebuilt only when a series changes (not on every
   *  live tick) so the canvases don't needlessly re-render. */
  protected chartOptions = computed<Map<string, EChartsOption>>(() => {
    const out = new Map<string, EChartsOption>();
    for (const list of this.widgetsByController().values())
      for (const { metric, widget } of list)
        out.set(widget.id, buildOption(metric, this.telemetry.seriesFor(widget)));
    return out;
  });

  /** Restarts (uptime resets) + offline gaps per controller, from the uptime series.
   *  Recomputes only when series change. The connectivity story, derived for free. */
  private connectivity = computed<Map<string, { restarts: number; gaps: number }>>(() => {
    const out = new Map<string, { restarts: number; gaps: number }>();
    for (const [controller, list] of this.widgetsByController()) {
      const up = list.find((x) => x.metric.isUptime);
      const pts = up ? this.telemetry.seriesFor(up.widget) : [];
      let restarts = 0, gaps = 0;
      for (let i = 1; i < pts.length; i++) {
        const a = pointValue(pts[i - 1]), b = pointValue(pts[i]);
        if (a != null && b != null && b < a - 1) restarts++; // uptime dropped => a reboot
        if (Date.parse(pts[i].ts) - Date.parse(pts[i - 1].ts) > OFFLINE_GAP_MS) gaps++;
      }
      out.set(controller, { restarts, gaps });
    }
    return out;
  });

  /** "2 restarts · 1 offline gap" / "No restarts in this window" under the uptime chart. */
  protected connectivityText(controller: string): string {
    const s = this.connectivity().get(controller) ?? { restarts: 0, gaps: 0 };
    const parts: string[] = [];
    if (s.restarts) parts.push(`${s.restarts} restart${s.restarts === 1 ? '' : 's'}`);
    if (s.gaps) parts.push(`${s.gaps} offline gap${s.gaps === 1 ? '' : 's'}`);
    return parts.length ? parts.join(' · ') : 'No restarts in this window';
  }

  protected hasData(widget: DashboardWidget): boolean {
    return this.telemetry.seriesFor(widget).length > 0;
  }

  /** Current value chip from the live shadow; '—' when never reported, "offline"
   *  when the device is dark and silent. */
  protected liveText(controller: string, metric: HealthMetric): string {
    const v = this.store.row(controller, metric.sensor)?.reported;
    if (v == null || !Number.isFinite(v)) return this.store.presence(controller).online ? '—' : 'offline';
    return metric.liveFmt(v);
  }

  /** The controller's remembered span (read off its first widget — `onSpan` keeps
   *  all four in lock-step). */
  protected span(controller: string): number {
    const w = this.widgets(controller)[0]?.widget;
    return w ? this.telemetry.spanFor(w) : 6;
  }
  /** Re-range all four of a controller's charts together. */
  protected onSpan(controller: string, hours: number): void {
    for (const { widget } of this.widgets(controller)) void this.telemetry.setSpan(this.siteId(), widget, hours);
  }

  /** Widget ids already fetched, so re-activating the section doesn't refetch. */
  private requested = new Set<string>();

  constructor() {
    // Lazy backfill: once the section is open and the spec is in, fetch each vitals
    // series. Reactive to both `active` and the spec, so a controller that loads
    // after the section opens still gets pulled.
    effect(() => {
      const site = this.siteId();
      if (!this.active() || !site) return;
      for (const list of this.widgetsByController().values())
        for (const { widget } of list)
          if (!this.requested.has(widget.id)) {
            this.requested.add(widget.id);
            void this.telemetry.load(site, widget);
          }
    });
  }
}
