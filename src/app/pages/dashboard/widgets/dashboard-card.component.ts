import { Component, computed, input } from '@angular/core';
import { NgxEchartsDirective } from 'ngx-echarts';
import type { EChartsOption } from 'echarts';
import {
  describeState,
  SYSTEM_STATE_MEANINGS, STOP_REASON_MEANINGS, FAULT_MEANINGS, OUTCOME_MEANINGS,
  type DashboardWidget, type StateKind,
} from '@core';
import type { ShadowRow, TelemetryPoint, StateEventRow } from '../../../core/models/runtime';

/** Combined token → meaning lookup for a transition `reason`/state (any vocab). */
const ANY_MEANING = { ...STOP_REASON_MEANINGS, ...FAULT_MEANINGS, ...OUTCOME_MEANINGS, ...SYSTEM_STATE_MEANINGS };

/** Map a meaning `kind` to a daisyUI badge colour class. */
function kindClass(kind: StateKind): string {
  switch (kind) {
    case 'active': return 'badge-success';
    case 'warn': return 'badge-warning';
    case 'fault': return 'badge-error';
    default: return 'badge-ghost';
  }
}

function fmt(n: number): string {
  if (Number.isNaN(n)) return '—';
  return Math.abs(n) >= 100 || Number.isInteger(n) ? String(Math.round(n)) : n.toFixed(1);
}

/** Dark-theme chart colours, matching the app's slate + cyan tokens. */
const CHART = {
  axis: '#334155',   // slate-700 — axis/split lines
  label: '#94a3b8',  // slate-400 — tick labels
  accent: '#22d3ee', // cyan-400 — series + gauge progress
  text: '#e2e8f0',   // slate-200 — value readout
} as const;

/**
 * One dashboard widget. Presentational: it takes its spec + already-resolved
 * data (a shadow row, a history series, or a transition list) and renders. The
 * page wires the right data from the stores. Gauge/line use ECharts; stat,
 * badge and timeline are plain daisyUI markup.
 */
@Component({
  selector: 'app-dashboard-card',
  standalone: true,
  imports: [NgxEchartsDirective],
  template: `
    <div class="bg-base-100 rounded-2xl ring-1 ring-base-300/40 hover:ring-base-300/70 transition-colors flex flex-col"
      [class]="dense() ? 'p-3' : 'p-4 min-h-[140px]'">
      @if (controllerLabel()) {
        <div class="flex items-center gap-1 mb-0.5 min-w-0">
          <span class="w-1.5 h-1.5 rounded-full shrink-0" [style.backgroundColor]="controllerColor()"></span>
          <span class="text-[9px] uppercase tracking-wide text-base-content/40 truncate" [title]="controllerLabel()">{{ controllerLabel() }}</span>
        </div>
      }
      <div class="flex items-baseline justify-between gap-2 mb-2">
        <span class="text-xs font-medium text-base-content/60 truncate">{{ widget().title }}</span>
        @if (widget().unit && widget().kind !== 'gauge' && widget().kind !== 'valve') {
          <span class="text-[10px] text-base-content/40 shrink-0">{{ widget().unit }}</span>
        }
      </div>

      @switch (widget().kind) {
        @case ('gauge') {
          <div echarts [options]="gaugeOption()" [autoResize]="true" class="flex-1 min-h-[120px]"></div>
        }
        @case ('line') {
          @if (series().length > 0) {
            <div echarts [options]="lineOption()" [autoResize]="true" class="flex-1 min-h-[100px]"></div>
          } @else {
            <div class="flex-1 min-h-[100px] flex items-center justify-center">
              <span class="text-xs text-base-content/30">No data yet</span>
            </div>
          }
        }
        @case ('flow') {
          <div class="flex-1 flex flex-col">
            @if (series().length > 0) {
              <div echarts [options]="lineOption()" [autoResize]="true" class="flex-1 min-h-[90px]"></div>
            } @else {
              <div class="flex-1 min-h-[90px] flex items-center justify-center">
                <span class="text-xs text-base-content/30">No flow yet</span>
              </div>
            }
            <div class="flex items-baseline justify-between mt-2 pt-2 border-t border-base-300/30">
              <span class="text-[11px] text-base-content/50">Total</span>
              <span class="text-lg font-semibold tabular-nums">{{ flowTotal() }}<span class="text-xs font-normal text-base-content/40 ml-1">L</span></span>
            </div>
          </div>
        }
        @case ('stat') {
          <div class="flex-1 flex items-center">
            <span class="text-3xl font-semibold tabular-nums">{{ statText() }}</span>
            @if (widget().unit) { <span class="ml-1 text-sm text-base-content/40">{{ widget().unit }}</span> }
          </div>
        }
        @case ('badge') {
          <div class="flex-1 flex items-center">
            <span class="badge {{ badge().cls }} badge-lg">{{ badge().label }}</span>
          </div>
        }
        @case ('valve') {
          <div class="flex-1 flex flex-col justify-center gap-2">
            <div class="flex items-baseline justify-between">
              <span class="text-lg font-semibold {{ valve().text }}">{{ valve().label }}</span>
              <span class="text-xs text-base-content/40 tabular-nums">{{ valve().pct }}%</span>
            </div>
            <div class="h-2.5 rounded-full bg-base-300/40 overflow-hidden">
              <div class="h-full rounded-full transition-all duration-500 {{ valve().cls }}" [style.width.%]="valve().pct"></div>
            </div>
            <div class="flex justify-between text-[10px] text-base-content/30">
              <span>Closed</span><span>Open</span>
            </div>
          </div>
        }
        @case ('timeline') {
          <div class="flex-1 overflow-auto max-h-[200px] -mx-1">
            @if (events().length === 0) {
              <p class="text-xs text-base-content/30 px-1 py-2">No activity yet.</p>
            }
            @for (e of events(); track e.ts + e.route) {
              <div class="px-1 py-1 border-b border-base-300/20 last:border-0 flex items-center gap-2 text-[11px]">
                <span class="badge badge-xs {{ kindOf(e.to) }}">{{ pretty(e.to) }}</span>
                <span class="text-base-content/50">route {{ e.route }}</span>
                @if (e.reason) { <span class="text-base-content/40">· {{ pretty(e.reason) }}</span> }
                <span class="ml-auto text-base-content/30 tabular-nums">{{ shortTime(e.ts) }}</span>
              </div>
            }
          </div>
        }
      }
    </div>
  `,
})
export class DashboardCardComponent {
  readonly widget = input.required<DashboardWidget>();
  readonly row = input<ShadowRow | undefined>(undefined);
  /** Companion cumulative-total shadow row for a `flow` widget. */
  readonly totalRow = input<ShadowRow | undefined>(undefined);
  readonly series = input<TelemetryPoint[]>([]);
  readonly events = input<StateEventRow[]>([]);
  /** Compact rendering for the dense status strip (small chips, no min height). */
  readonly dense = input(false);
  /** Owning controller's name + colour, shown only when a site has >1 controller. */
  readonly controllerLabel = input('');
  readonly controllerColor = input('#94a3b8');

  protected statText = computed(() => {
    const r = this.row();
    return r ? fmt(r.reported) : '—';
  });

  /** Cumulative volume for the `flow` widget's total footer. */
  protected flowTotal = computed(() => {
    const r = this.totalRow();
    return r ? fmt(r.reported) : '—';
  });

  protected badge = computed<{ label: string; cls: string }>(() => {
    const w = this.widget();
    const r = this.row();
    if (w.meanings) {
      const token = r?.reported_text ?? '';
      if (!token) return { label: '—', cls: 'badge-ghost' };
      const m = describeState(w.meanings, token);
      return { label: m.label, cls: kindClass(m.kind) };
    }
    // Boolean channel (pump / dosing / safety override): numeric 1/0.
    if (!r) return { label: '—', cls: 'badge-ghost' };
    return r.reported >= 0.5 ? { label: 'On', cls: 'badge-success' } : { label: 'Off', cls: 'badge-ghost' };
  });

  /** Valve position from the cover's 0..1 shadow value → bar %, label, colour. */
  protected valve = computed<{ pct: number; label: string; cls: string; text: string }>(() => {
    const r = this.row();
    const pos = r ? Number(r.reported) : NaN;
    if (Number.isNaN(pos)) return { pct: 0, label: '—', cls: 'bg-base-content/20', text: 'text-base-content/40' };
    const pct = Math.round(Math.max(0, Math.min(1, pos)) * 100);
    if (pct <= 2) return { pct: 0, label: 'Closed', cls: 'bg-base-content/30', text: 'text-base-content/50' };
    if (pct >= 98) return { pct: 100, label: 'Open', cls: 'bg-success', text: 'text-success' };
    return { pct, label: `${pct}% open`, cls: 'bg-warning', text: 'text-warning' };
  });

  protected gaugeOption = computed<EChartsOption>(() => {
    const w = this.widget();
    const r = this.row();
    const max = w.max ?? 100;
    const value = r ? r.reported : 0;
    // A clean half-donut: wide top arc that fills the card's width, the value
    // read out in the middle, no needle (the fill is the signal). Robust to the
    // card's wide aspect — unlike the default 270° gauge, which renders as a tiny
    // off-centre sliver in a short, wide container.
    return {
      series: [
        {
          type: 'gauge',
          startAngle: 200,
          endAngle: -20,
          center: ['50%', '62%'],
          radius: '92%',
          min: w.min ?? 0,
          max,
          progress: { show: true, width: 12, roundCap: true, itemStyle: { color: CHART.accent } },
          axisLine: { lineStyle: { width: 12, color: [[1, 'rgba(148,163,184,0.18)']] } },
          axisLabel: { show: false },
          axisTick: { show: false },
          splitLine: { show: false },
          pointer: { show: false },
          anchor: { show: false },
          title: { show: false },
          detail: {
            valueAnimation: true,
            formatter: (v: number) => `${fmt(v)}${w.unit ?? ''}`,
            fontSize: 24,
            fontWeight: 'bolder',
            offsetCenter: [0, '-2%'],
            color: CHART.text,
          },
          data: [{ value }],
        },
      ],
    };
  });

  protected lineOption = computed<EChartsOption>(() => {
    const data = this.series().map((p) => [p.ts, p.value ?? p.avg ?? null]);
    return {
      textStyle: { color: CHART.label },
      grid: { left: 44, right: 12, top: 12, bottom: 24 },
      xAxis: {
        type: 'time',
        axisLine: { lineStyle: { color: CHART.axis } },
        axisLabel: { color: CHART.label },
        splitLine: { show: false },
      },
      yAxis: {
        type: 'value',
        axisLine: { show: false },
        axisLabel: { color: CHART.label },
        splitLine: { lineStyle: { color: CHART.axis } },
      },
      tooltip: { trigger: 'axis' },
      series: [{
        type: 'line', showSymbol: false, smooth: true, data,
        lineStyle: { color: CHART.accent },
        itemStyle: { color: CHART.accent },
        areaStyle: { color: 'rgba(34,211,238,0.12)' },
      }],
    };
  });

  protected pretty(token: string): string {
    return token ? describeState(ANY_MEANING, token).label : '';
  }

  protected kindOf(token: string): string {
    return token ? kindClass(describeState(ANY_MEANING, token).kind) : 'badge-ghost';
  }

  protected shortTime(ts: string): string {
    const d = new Date(ts);
    return Number.isNaN(d.getTime()) ? ts : d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }
}
