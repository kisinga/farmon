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
    <div class="bg-base-100 rounded-xl border border-base-300/40 p-4 flex flex-col min-h-[140px]">
      <div class="flex items-baseline justify-between mb-2">
        <span class="text-xs font-medium text-base-content/60">{{ widget().title }}</span>
        @if (widget().unit) { <span class="text-[10px] text-base-content/40">{{ widget().unit }}</span> }
      </div>

      @switch (widget().kind) {
        @case ('gauge') {
          <div echarts [options]="gaugeOption()" [autoResize]="true" class="flex-1 min-h-[120px]"></div>
        }
        @case ('line') {
          <div echarts [options]="lineOption()" [autoResize]="true" class="flex-1 min-h-[120px]"></div>
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
  readonly series = input<TelemetryPoint[]>([]);
  readonly events = input<StateEventRow[]>([]);

  protected statText = computed(() => {
    const r = this.row();
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

  protected gaugeOption = computed<EChartsOption>(() => {
    const w = this.widget();
    const r = this.row();
    return {
      series: [
        {
          type: 'gauge',
          min: w.min ?? 0,
          max: w.max ?? 100,
          progress: { show: true, width: 8 },
          axisLine: { lineStyle: { width: 8 } },
          axisLabel: { show: false },
          axisTick: { show: false },
          splitLine: { show: false },
          pointer: { width: 4 },
          detail: {
            valueAnimation: true,
            formatter: (v: number) => `${fmt(v)}${w.unit ?? ''}`,
            fontSize: 18,
            offsetCenter: [0, '70%'],
          },
          data: [{ value: r ? r.reported : 0 }],
        },
      ],
    };
  });

  protected lineOption = computed<EChartsOption>(() => {
    const data = this.series().map((p) => [p.ts, p.value ?? p.avg ?? null]);
    return {
      grid: { left: 44, right: 12, top: 12, bottom: 24 },
      xAxis: { type: 'time' },
      yAxis: { type: 'value' },
      tooltip: { trigger: 'axis' },
      series: [{ type: 'line', showSymbol: false, smooth: true, data }],
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
