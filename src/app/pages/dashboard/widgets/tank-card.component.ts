import { Component, computed, input, output, signal } from '@angular/core';
import { NgxEchartsDirective } from 'ngx-echarts';
import type { EChartsOption } from 'echarts';
import type { DashboardWidget } from '@core';
import type { ShadowRow, TelemetryPoint } from '../../../core/models/runtime';
import { SPAN_PRESETS } from '../telemetry.store';
import { SpanSelectorComponent } from './span-selector.component';

/** Dark-theme chart colours (shared look with the other cards). */
const CHART = { axis: '#334155', label: '#94a3b8', accent: '#22d3ee' } as const;

let uidSeq = 0;

/**
 * TankCardComponent — a level-monitored tank's live fill + history.
 *
 * The collapsed tile is the dominant visual: a believable cylinder whose water
 * rises/falls with the live level % (smooth transition + a subtle surface wave),
 * coloured by how full it is. Tapping it reveals a tall trend chart with an ECharts
 * `dataZoom` (drag/scroll to zoom the window) on a fixed 0–100% axis; history is
 * lazy-loaded on first open. Purely presentational — the page wires the live row,
 * the history series, and the load/span events.
 */
@Component({
  selector: 'app-tank-card',
  standalone: true,
  imports: [NgxEchartsDirective, SpanSelectorComponent],
  styles: [`
    @keyframes tank-wave { from { transform: translateX(0); } to { transform: translateX(-32px); } }
    .tank-wave { animation: tank-wave 2.8s linear infinite; }
    @media (prefers-reduced-motion: reduce) { .tank-wave { animation: none; } }
  `],
  template: `
    <div class="flex flex-col">
      <button type="button" class="w-full flex items-center gap-4 text-left cursor-pointer group"
              (click)="toggleExpand()" [attr.aria-expanded]="expanded()"
              [title]="expanded() ? 'Hide history' : 'Show level over time'">
        <!-- Tank cylinder: outline + clipped water fill + meniscus + wave. -->
        <span class="shrink-0 {{ tone() }} transition-colors">
          <svg class="h-28 w-auto" viewBox="0 0 96 84" fill="none" aria-hidden="true">
            <defs>
              <clipPath [attr.id]="clipId">
                <path d="M8 12 A40 8 0 0 1 88 12 L88 72 A40 8 0 0 1 8 72 Z" />
              </clipPath>
            </defs>
            <!-- empty body: a wide, squat storage tank -->
            <path d="M8 12 A40 8 0 0 1 88 12 L88 72 A40 8 0 0 1 8 72 Z"
                  stroke="currentColor" stroke-width="2.5" style="fill:var(--color-base-200)" />
            <!-- faint seam bands for a real-tank read -->
            <ellipse cx="48" cy="32" rx="40" ry="8" stroke="currentColor" stroke-width="1" stroke-opacity="0.12" fill="none" />
            <ellipse cx="48" cy="52" rx="40" ry="8" stroke="currentColor" stroke-width="1" stroke-opacity="0.12" fill="none" />
            <!-- water (clipped to the tank), animating its top as % changes -->
            <g [attr.clip-path]="'url(#' + clipId + ')'">
              <rect x="6" [attr.y]="waterY()" width="84" [attr.height]="84 - waterY()"
                    fill="currentColor" fill-opacity="0.85" class="transition-all duration-700 ease-out" />
              <!-- surface ellipse (meniscus) + wave at the waterline -->
              <g [attr.transform]="'translate(0,' + waterY() + ')'" class="transition-all duration-700 ease-out">
                <ellipse cx="48" cy="0" rx="40" ry="7.5" fill="currentColor" />
                <path class="tank-wave" d="M-16 -2 q 8 -5 16 0 t 16 0 t 16 0 t 16 0 t 16 0 t 16 0 t 16 0 t 16 0 L 112 10 L -16 10 Z"
                      fill="currentColor" fill-opacity="0.35" />
              </g>
            </g>
            <!-- top rim, drawn last so it reads in front of the water -->
            <ellipse cx="48" cy="12" rx="40" ry="8" stroke="currentColor" stroke-width="2.5" fill="none" />
          </svg>
        </span>

        <div class="min-w-0 flex-1">
          <div class="text-4xl font-bold tabular-nums leading-none {{ tone() }}">
            {{ pctText() }}<span class="text-lg font-medium opacity-50 ml-0.5">%</span>
          </div>
          <div class="text-[11px] text-base-content/50 mt-1.5 inline-flex items-center gap-1 group-hover:text-base-content/70">
            {{ expanded() ? 'Hide level history' : 'Level · tap for history' }}
            <svg class="h-3 w-3 transition-transform" [class.rotate-180]="expanded()" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M4 6l4 4 4-4" stroke-linecap="round" stroke-linejoin="round" />
            </svg>
          </div>
        </div>
      </button>

      @if (expanded()) {
        <div class="mt-3 pt-3 border-t border-base-300/30">
          <div class="flex items-center justify-between gap-2 mb-2">
            <span class="text-[11px] text-base-content/40 shrink-0">Level over time</span>
            <app-span-selector [span]="span()" (spanChange)="spanChange.emit($event)" />
          </div>
          @if (!historyLoaded()) {
            <div class="h-48 flex items-center justify-center gap-2 text-base-content/30">
              <span class="loading loading-spinner loading-sm"></span><span class="text-xs">Loading history…</span>
            </div>
          } @else if (series().length > 0) {
            <div echarts [options]="chartOption()" [autoResize]="true" class="h-48"></div>
            <p class="text-[10px] text-base-content/30 text-center mt-1">Drag the slider or scroll the chart to zoom</p>
          } @else {
            <div class="h-48 flex items-center justify-center"><span class="text-xs text-base-content/30">No level history in this window yet</span></div>
          }
        </div>
      }
    </div>
  `,
})
export class TankCardComponent {
  readonly widget = input.required<DashboardWidget>();
  readonly row = input<ShadowRow | undefined>(undefined);
  readonly series = input<TelemetryPoint[]>([]);
  readonly span = input<number>(SPAN_PRESETS[0].hours);
  /** History fetch has completed (distinguishes loading from empty). */
  readonly historyLoaded = input(false);

  /** First open of the history panel — the page loads the series. */
  readonly expand = output<void>();
  /** Operator picked a new fetch window. */
  readonly spanChange = output<number>();

  protected readonly clipId = `tankclip-${uidSeq++}`;
  protected expanded = signal(false);
  private requested = false;

  /** Live level 0–100, or null when never reported. */
  private pct = computed<number | null>(() => {
    const r = this.row();
    const v = r ? Number(r.reported) : NaN;
    return Number.isNaN(v) ? null : Math.max(0, Math.min(100, v));
  });
  protected pctText = computed(() => { const p = this.pct(); return p === null ? '—' : String(Math.round(p)); });

  /** Waterline y in the 84-tall viewBox: interior runs y=12 (full) → y=72 (empty). */
  protected waterY = computed(() => 72 - 0.6 * (this.pct() ?? 0));

  /** Low reads warning, near-full reads info, mid reads primary; unknown is muted. */
  protected tone = computed(() => {
    const p = this.pct();
    if (p === null) return 'text-base-content/30';
    if (p <= 15) return 'text-warning';
    if (p >= 95) return 'text-info';
    return 'text-primary';
  });

  protected toggleExpand(): void {
    const next = !this.expanded();
    this.expanded.set(next);
    if (next && !this.requested) { this.requested = true; this.expand.emit(); }
  }

  protected chartOption = computed<EChartsOption>(() => {
    const data = this.series().map((p) => [p.ts, p.value ?? p.avg ?? null]);
    return {
      textStyle: { color: CHART.label },
      grid: { left: 40, right: 14, top: 12, bottom: 52 },
      xAxis: {
        type: 'time',
        axisLine: { lineStyle: { color: CHART.axis } },
        axisLabel: { color: CHART.label },
        splitLine: { show: false },
      },
      yAxis: {
        type: 'value', min: 0, max: 100,
        axisLine: { show: false },
        axisLabel: { color: CHART.label, formatter: '{value}%' },
        splitLine: { lineStyle: { color: CHART.axis } },
      },
      tooltip: { trigger: 'axis', valueFormatter: (v) => `${Math.round(Number(v))}%` },
      dataZoom: [
        { type: 'inside', throttle: 50 },
        {
          type: 'slider', height: 18, bottom: 8,
          borderColor: 'transparent',
          fillerColor: 'rgba(34,211,238,0.15)',
          handleStyle: { color: CHART.accent },
          textStyle: { color: CHART.label },
          dataBackground: { lineStyle: { color: CHART.axis }, areaStyle: { color: 'rgba(34,211,238,0.08)' } },
        },
      ],
      series: [{
        type: 'line', showSymbol: false, smooth: true, data,
        lineStyle: { color: CHART.accent, width: 2 },
        itemStyle: { color: CHART.accent },
        areaStyle: { color: 'rgba(34,211,238,0.16)' },
      }],
    };
  });
}
