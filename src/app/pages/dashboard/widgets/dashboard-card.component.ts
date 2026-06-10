import { Component, computed, input, output } from '@angular/core';
import { NgxEchartsDirective } from 'ngx-echarts';
import type { EChartsOption } from 'echarts';
import {
  describeState,
  SYSTEM_STATE_MEANINGS, STOP_REASON_MEANINGS, FAULT_MEANINGS, OUTCOME_MEANINGS,
  type DashboardWidget, type StateKind,
} from '@core';
import type { ShadowRow, TelemetryPoint, StateEventRow } from '../../../core/models/runtime';
import { SPAN_PRESETS, DEFAULT_SPAN_HOURS } from '../telemetry.store';

/** A history point's numeric value. `end` selects the bucket edge for a
 *  cumulative counter: 'lo' (min) for a window start, 'hi' (max) for its end;
 *  raw points carry a single `value`. */
function ptVal(p: TelemetryPoint, end: 'lo' | 'hi'): number {
  if (p.value !== undefined) return p.value;
  if (end === 'lo') return p.min ?? p.avg ?? NaN;
  return p.max ?? p.avg ?? NaN;
}

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
  // Fill the grid cell so sibling cards in a row are the same height.
  host: { class: 'block h-full' },
  template: `
    <div class="bg-base-100 rounded-2xl transition-all flex flex-col h-full"
      [class]="cardClass()"
      [attr.role]="actuatable() ? 'button' : null"
      [attr.tabindex]="actuatable() && !actuatorBusy() ? '0' : null"
      [attr.title]="actuatable() ? holdHint() : null"
      (click)="onCardClick()"
      (keydown.enter)="onCardClick()"
      (keydown.space)="onSpace($event)">
      @if (controllerLabel()) {
        <div class="flex items-center gap-1 mb-0.5 min-w-0">
          <span class="w-1.5 h-1.5 rounded-full shrink-0" [style.backgroundColor]="controllerColor()"></span>
          <span class="text-[9px] uppercase tracking-wide text-base-content/40 truncate" [title]="controllerLabel()">{{ controllerLabel() }}</span>
        </div>
      }
      <div class="flex items-baseline justify-between gap-2 mb-2">
        <span class="text-xs font-medium text-base-content/60 truncate">{{ widget().title }}</span>
        @if (isCharted()) {
          <!-- Unit + per-chart timescale. Spans are capped at the 30d retention
               ceiling (see SPAN_PRESETS), so every option returns real data. -->
          <div class="flex items-center gap-1 shrink-0">
            @if (widget().unit) {
              <span class="text-[10px] text-base-content/40">{{ widget().unit }}</span>
            }
            <select class="select select-xs select-ghost h-5 min-h-0 px-1 -my-1 text-[10px] text-base-content/50"
              [value]="span()" (change)="onSpanChange($event)" (click)="$event.stopPropagation()">
              @for (p of spanPresets; track p.hours) {
                <option [value]="p.hours">{{ p.label }}</option>
              }
            </select>
          </div>
        } @else if (widget().unit && widget().kind !== 'gauge' && widget().kind !== 'valve') {
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
            @if (windowUsed() !== null) {
              <div class="flex items-baseline justify-between mt-1">
                <span class="text-[11px] text-base-content/50">Used · {{ spanLabel() }}</span>
                <span class="text-sm font-semibold tabular-nums">{{ fmtUsed() }}<span class="text-xs font-normal text-base-content/40 ml-1">L</span></span>
              </div>
            }
          </div>
        }
        @case ('stat') {
          <div class="flex-1 flex items-center">
            <span class="text-3xl font-semibold tabular-nums">{{ statText() }}</span>
            @if (widget().unit) { <span class="ml-1 text-sm text-base-content/40">{{ widget().unit }}</span> }
          </div>
        }
        @case ('badge') {
          @if (actuatorKind() === 'pump') {
            <!-- Pump control: a pump-on-pipe glyph + state, laid out exactly like
                 the valve card so the two control tiles standardize. -->
            <div class="flex-1 flex items-center gap-3">
              <span class="shrink-0 {{ pump().text }} transition-colors">
                <svg class="h-11 w-auto" viewBox="0 0 56 46" fill="none">
                  <line x1="2" y1="30" x2="54" y2="30" stroke="currentColor" stroke-width="5" stroke-linecap="round" stroke-opacity="0.5" />
                  <circle cx="28" cy="22" r="11" stroke="currentColor" stroke-width="2" style="fill:var(--color-base-100)" />
                  <path d="M24 17 L34 22 L24 27 Z" fill="currentColor" />
                </svg>
              </span>
              <div class="min-w-0">
                <div class="text-sm font-semibold {{ pump().text }} truncate">{{ pump().label }}</div>
                <div class="text-[11px] text-base-content/40">{{ pump().sub }}</div>
              </div>
            </div>
          } @else {
            <div class="flex-1 flex items-center">
              <span class="badge {{ badge().cls }} badge-lg">{{ badge().label }}</span>
            </div>
          }
        }
        @case ('valve') {
          <!-- Gate-valve glyph: the gate descends from the handwheel into the
               pipe, and the open passage fills with water — the water height IS
               the % open (closed = gate spans the pipe, open = gate retracted,
               pipe full). Colour tracks state. -->
          <div class="flex-1 flex items-center gap-3">
            <span class="shrink-0 {{ valve().text }} transition-colors">
              <svg class="h-11 w-auto" viewBox="0 0 56 46" fill="none">
                <!-- pipe / chamber -->
                <rect x="1.5" y="20" width="53" height="16" rx="3" stroke="currentColor" stroke-width="2" style="fill:var(--color-base-200)" />
                <!-- water in the open passage; height = % open, filling from the floor up -->
                <rect x="3" [attr.y]="35 - 0.14 * valve().pct" width="50" [attr.height]="0.14 * valve().pct" rx="2" fill="currentColor" />
                <!-- gate, descending from the bonnet; its tip rests at the waterline -->
                <rect x="23" y="9" width="10" [attr.height]="26 - 0.14 * valve().pct" rx="1.5" stroke="currentColor" stroke-width="1.5" style="fill:var(--color-base-300)" />
                <!-- stem + handwheel -->
                <line x1="28" y1="9" x2="28" y2="4" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" />
                <line x1="21" y1="4" x2="35" y2="4" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" />
              </svg>
            </span>
            <div class="min-w-0">
              <div class="text-sm font-semibold {{ valve().text }} truncate">{{ valve().label }}</div>
              <div class="text-[11px] text-base-content/40 tabular-nums">{{ valve().pct }}% open</div>
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

      <!-- Actuator hold (valve / pump): the card itself toggles a manual claim,
           so there's no separate control cluster. Shows only when controllable. -->
      @if (actuatable()) {
        <div class="mt-2 pt-2 border-t border-base-300/20 flex items-center gap-1.5 text-[11px] select-none">
          <span class="w-1.5 h-1.5 rounded-full shrink-0 {{ held() ? 'bg-primary animate-pulse' : 'bg-base-content/30' }}"></span>
          <span class="truncate {{ held() ? 'text-primary font-medium' : 'text-base-content/50' }}">{{ holdHint() }}</span>
        </div>
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
  /** Cumulative-total series for a `flow` widget, over the selected span — drives
   *  the "used in window" readout. */
  readonly totalSeries = input<TelemetryPoint[]>([]);
  readonly events = input<StateEventRow[]>([]);
  /** Current chart span in hours (line/flow only). */
  readonly span = input<number>(DEFAULT_SPAN_HOURS);
  /** Operator picked a new span for this chart. */
  readonly spanChange = output<number>();
  /** Compact rendering for the dense status strip (small chips, no min height). */
  readonly dense = input(false);
  /** Owning controller's name + colour, shown only when a site has >1 controller. */
  readonly controllerLabel = input('');
  readonly controllerColor = input('#94a3b8');

  /** This card maps to a controllable actuator (valve/pump) and can be toggled
   *  right now — clicking the card holds/releases it. False ⇒ status-only. */
  readonly actuatable = input(false);
  /** The actuator is currently held (claimed) by this operator. */
  readonly held = input(false);
  /** A claim/release for this actuator is in flight. */
  readonly actuatorBusy = input(false);
  /** Structural actuator kind (independent of online/control state) — drives the
   *  pump's glyph layout so it matches the valve card. '' ⇒ not an actuator. */
  readonly actuatorKind = input<'' | 'valve' | 'pump'>('');
  /** Click toggled the actuator hold — the page issues the claim/release. */
  readonly toggle = output<void>();

  /** Root classes: read-only status cards get a plain grey ring; actuatable
   *  control cards are tinted (cyan accent ring, filled while held) so they
   *  read as interactive — distinct from the surrounding status tiles. */
  protected cardClass = computed(() => {
    const pad = this.dense() ? 'p-3' : 'p-4 min-h-[140px]';
    if (!this.actuatable()) return `${pad} ring-1 ring-base-300/40 hover:ring-base-300/70`;
    if (this.actuatorBusy()) return `${pad} ring-1 ring-primary/30 opacity-60 cursor-wait`;
    return this.held()
      ? `${pad} ring-1 ring-primary/70 bg-primary/10 cursor-pointer`
      : `${pad} ring-1 ring-primary/30 hover:ring-primary/60 cursor-pointer`;
  });

  /** Footer affordance copy, by actuator kind + held state. */
  protected holdHint(): string {
    const valve = this.widget().kind === 'valve';
    if (this.held()) return valve ? 'Holding open · tap to close' : 'Running · tap to stop';
    return valve ? 'Tap to open' : 'Tap to run';
  }

  protected onCardClick(): void {
    if (this.actuatable() && !this.actuatorBusy()) this.toggle.emit();
  }

  /** Space activates the card without scrolling the page. */
  protected onSpace(e: Event): void {
    if (this.actuatable() && !this.actuatorBusy()) { e.preventDefault(); this.toggle.emit(); }
  }

  protected statText = computed(() => {
    const r = this.row();
    return r ? fmt(r.reported) : '—';
  });

  /** Cumulative volume for the `flow` widget's total footer. */
  protected flowTotal = computed(() => {
    const r = this.totalRow();
    return r ? fmt(r.reported) : '—';
  });

  /** Span selector data + helpers (line/flow charts only). */
  protected readonly spanPresets = SPAN_PRESETS;
  protected isCharted = computed(() => this.widget().kind === 'line' || this.widget().kind === 'flow');
  protected spanLabel = computed(() =>
    SPAN_PRESETS.find((p) => p.hours === this.span())?.label ?? `${this.span()}h`,
  );
  protected onSpanChange(e: Event): void {
    const hours = Number((e.target as HTMLSelectElement).value);
    if (Number.isFinite(hours) && hours > 0) this.spanChange.emit(hours);
  }

  /** Water used over the selected window: cumulative-total delta (last − first),
   *  clamped at 0 so a counter reset on reboot reads as no usage rather than a
   *  large negative. null when there isn't enough of the total series to span. */
  protected windowUsed = computed<number | null>(() => {
    const s = this.totalSeries();
    if (s.length < 2) return null;
    const first = ptVal(s[0], 'lo');
    const last = ptVal(s[s.length - 1], 'hi');
    if (Number.isNaN(first) || Number.isNaN(last)) return null;
    return Math.max(0, last - first);
  });
  protected fmtUsed = computed(() => {
    const u = this.windowUsed();
    return u === null ? '—' : fmt(u);
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

  /** Pump on/off from its relay shadow (1/0) → label, sub-line, colour. Mirrors
   *  `valve()` so the pump control tile reads the same as the valve one. */
  protected pump = computed<{ on: boolean; label: string; sub: string; text: string }>(() => {
    const r = this.row();
    return r && r.reported >= 0.5
      ? { on: true, label: 'On', sub: 'running', text: 'text-success' }
      : { on: false, label: 'Off', sub: 'stopped', text: 'text-base-content/50' };
  });

  /** Valve position from the cover's 0..1 shadow value → glyph %, label, colour. */
  protected valve = computed<{ pct: number; label: string; text: string }>(() => {
    const r = this.row();
    const pos = r ? Number(r.reported) : NaN;
    if (Number.isNaN(pos)) return { pct: 0, label: '—', text: 'text-base-content/40' };
    const pct = Math.round(Math.max(0, Math.min(1, pos)) * 100);
    if (pct <= 2) return { pct: 0, label: 'Closed', text: 'text-base-content/50' };
    if (pct >= 98) return { pct: 100, label: 'Open', text: 'text-success' };
    return { pct, label: 'Part open', text: 'text-warning' };
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
