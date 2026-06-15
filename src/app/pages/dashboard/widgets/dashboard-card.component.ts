import { Component, computed, input, output } from '@angular/core';
import { NgxEchartsDirective } from 'ngx-echarts';
import type { EChartsOption } from 'echarts';
import { TankCardComponent } from './tank-card.component';
import { SpanSelectorComponent } from './span-selector.component';
import {
  describeState,
  SYSTEM_STATE_MEANINGS, STOP_REASON_MEANINGS, FAULT_MEANINGS, OUTCOME_MEANINGS,
  type DashboardWidget, type StateKind, type CommandPhase, type RuntimeState,
} from '@core';
import type { ShadowRow, TelemetryPoint, ActivityItem } from '../../../core/models/runtime';
import { formatInitiator } from './initiator';
import { SPAN_PRESETS, DEFAULT_SPAN_HOURS } from '../telemetry.store';
import { integrateLiters } from '../flow-usage';
import { phaseUi } from './command-phase';

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

/** Severity `kind` → activity-rail dot / inline-token colours (shared so the dot
 *  and the state word always agree). */
const DOT_CLASS: Record<string, string> = {
  active: 'bg-success', warn: 'bg-warning', fault: 'bg-error', normal: 'bg-base-content/25',
};
const TOKEN_CLASS: Record<string, string> = {
  active: 'text-success', warn: 'text-warning', fault: 'text-error', normal: 'text-base-content/40',
};

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
  imports: [NgxEchartsDirective, TankCardComponent, SpanSelectorComponent],
  // Fill the grid cell so sibling cards in a row are the same height.
  host: { class: 'block h-full' },
  template: `
    <div class="bg-base-100 rounded-xl transition-all flex flex-col h-full"
      [class]="cardClass()"
      [attr.role]="actuatable() ? 'button' : null"
      [attr.tabindex]="actuatable() && !busy() ? '0' : null"
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
      <div class="flex items-baseline justify-between gap-2 mb-1.5">
        <span class="text-xs font-semibold text-base-content/70 truncate">{{ widget().title }}</span>
        @if (isCharted()) {
          <!-- Unit + per-chart timescale (segment buttons, not a native select whose
               popup floats over the chart). Spans cap at the 30d retention ceiling. -->
          <div class="flex items-center gap-1.5 shrink-0">
            @if (widget().unit) {
              <span class="text-[10px] text-base-content/40">{{ widget().unit }}</span>
            }
            <app-span-selector [span]="span()" (spanChange)="spanChange.emit($event)" />
          </div>
        } @else if (widget().unit && widget().kind !== 'gauge' && widget().kind !== 'valve' && widget().kind !== 'tank') {
          <span class="text-[10px] text-base-content/40 shrink-0">{{ widget().unit }}</span>
        }
      </div>

      @switch (widget().kind) {
        @case ('gauge') {
          <div echarts [options]="gaugeOption()" [autoResize]="true" class="flex-1 min-h-[120px]"></div>
        }
        @case ('tank') {
          <app-tank-card
            [widget]="widget()"
            [row]="row()"
            [series]="series()"
            [span]="span()"
            [historyLoaded]="historyLoaded()"
            (expand)="expand.emit()"
            (spanChange)="spanChange.emit($event)" />
        }
        @case ('line') {
          @if (series().length > 0) {
            <div echarts [options]="lineOption()" [autoResize]="true" class="flex-1 min-h-[120px]"></div>
          } @else {
            <div class="flex-1 min-h-[120px] flex items-center justify-center">
              <span class="text-xs text-base-content/30">No data yet</span>
            </div>
          }
        }
        @case ('flow') {
          <div class="flex-1 flex flex-col">
            @if (series().length > 0) {
              <div echarts [options]="lineOption()" [autoResize]="true" class="flex-1 min-h-[110px]"></div>
            } @else {
              <div class="flex-1 min-h-[110px] flex items-center justify-center">
                <span class="text-xs text-base-content/30">No flow yet</span>
              </div>
            }
            @if (windowUsed() !== null) {
              <div class="flex items-baseline justify-between mt-2 pt-2 border-t border-base-300/30">
                <span class="text-[11px] text-base-content/50">Used · {{ spanLabel() }}</span>
                <span class="text-lg font-semibold tabular-nums">{{ fmtUsed() }}<span class="text-xs font-normal text-base-content/40 ml-1">L</span></span>
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
          <div class="flex-1 overflow-auto max-h-60 -mr-1.5 pr-1.5">
            @if (items().length === 0) {
              <div class="h-full min-h-18 flex items-center justify-center">
                <span class="text-xs text-base-content/25">No activity yet</span>
              </div>
            } @else {
              <ol>
                @for (it of items(); track it.ts + it.label; let last = $last) {
                  <li class="flex gap-2.5">
                    <!-- timeline rail: a severity-coloured dot, connected to the next -->
                    <div class="flex flex-col items-center shrink-0">
                      <span class="w-1.5 h-1.5 rounded-full mt-1.5 {{ dotClass(it) }}"></span>
                      @if (!last) { <span class="w-px grow bg-base-300/25 my-0.5"></span> }
                    </div>
                    <!-- content -->
                    <div class="min-w-0 flex-1 flex items-center gap-2 text-xs py-1 {{ last ? '' : 'pb-2' }}">
                      <span class="truncate {{ it.ok === false ? 'text-error/90' : 'text-base-content/80' }}">{{ it.label }}</span>
                      @if (it.token) { <span class="shrink-0 {{ tokenClass(it.token) }}">{{ pretty(it.token) }}</span> }
                      @if (it.detail) { <span class="shrink-0 text-base-content/35 truncate hidden sm:inline">· {{ pretty(it.detail) }}</span> }
                      <span class="ml-auto shrink-0 flex items-center gap-2">
                        @if (actorText(it); as at) {
                          @if (it.bySupport) {
                            <span class="px-1.5 py-px rounded text-[10px] font-medium bg-warning/15 text-warning cursor-help" [title]="it.actorTitle ?? ''">{{ at }}</span>
                          } @else if (it.origin === 'AUTOMATION') {
                            <span class="text-[10px] text-info/65 cursor-help" [title]="it.actorTitle ?? ''">{{ at }}</span>
                          } @else {
                            <span class="text-[10px] text-base-content/45 cursor-help" [title]="it.actorTitle ?? ''">{{ at }}</span>
                          }
                        }
                        <span class="text-[10px] text-base-content/30 tabular-nums">{{ shortTime(it.ts) }}</span>
                      </span>
                    </div>
                  </li>
                }
              </ol>
            }
          </div>
        }
      }

      <!-- Actuator hold (valve / pump): the card itself toggles a manual claim,
           so there's no separate control cluster. Shows only when controllable. -->
      @if (actuatable()) {
        <div class="mt-2 pt-2 border-t border-base-300/20 flex items-center gap-1.5 text-[11px] select-none {{ footerTone() }}">
          @if (cmd()?.spin) {
            <span class="loading loading-spinner loading-xs shrink-0"></span>
          } @else {
            <span class="w-1.5 h-1.5 rounded-full shrink-0 {{ footerDot() }}"></span>
          }
          <span class="truncate">{{ footerText() }}</span>
        </div>
      }
    </div>
  `,
})
export class DashboardCardComponent {
  readonly widget = input.required<DashboardWidget>();
  readonly row = input<ShadowRow | undefined>(undefined);
  /** Canonical node state from the shared projection (`store.nodeRuntime`), when
   *  this card maps to a topology node. Drives the boolean on/off (pump + bool
   *  badge) so the card and the live map agree; the valve keeps its own position
   *  math (finer than on/off). Null ⇒ fall back to the shadow. */
  readonly state = input<RuntimeState | null>(null);
  readonly series = input<TelemetryPoint[]>([]);
  readonly items = input<ActivityItem[]>([]);
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
  /** Live command phase for this actuator's claim/release (null ⇒ none in flight). */
  readonly phase = input<CommandPhase | null>(null);
  /** Refusal reason token accompanying a `refused` phase (best-effort). */
  readonly phaseReason = input('');
  /** Structural actuator kind (independent of online/control state) — drives the
   *  pump's glyph layout so it matches the valve card. '' ⇒ not an actuator. */
  readonly actuatorKind = input<'' | 'valve' | 'pump'>('');
  /** Click toggled the actuator hold — the page issues the claim/release. */
  readonly toggle = output<void>();
  /** First time the tank's history view is opened — the page loads its series. */
  readonly expand = output<void>();
  /** History fetch completed (forwarded to the tank card to distinguish loading from empty). */
  readonly historyLoaded = input(false);

  /** A claim/release is in flight (pending) — disables the card + shows a spinner. */
  protected busy = computed(() => this.phase() === 'pending');
  /** Command-phase presentation (spinner / alert), null when idle. */
  protected cmd = computed(() => { const p = this.phase(); return p ? phaseUi(p) : null; });

  /** Root classes: read-only status cards get a plain grey ring; actuatable
   *  control cards are tinted (cyan accent ring, filled while held) so they
   *  read as interactive — distinct from the surrounding status tiles. */
  protected cardClass = computed(() => {
    const pad = this.dense() ? 'p-3' : 'p-3 min-h-[128px]';
    if (!this.actuatable()) return `${pad} ring-1 ring-base-300/40 hover:ring-base-300/70`;
    if (this.cmd()?.alert) return `${pad} ring-1 ring-error/60 cursor-pointer`;
    if (this.busy()) return `${pad} ring-1 ring-primary/30 opacity-60 cursor-wait`;
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
    if (this.actuatable() && !this.busy()) this.toggle.emit();
  }

  /** Space activates the card without scrolling the page. */
  protected onSpace(e: Event): void {
    if (this.actuatable() && !this.busy()) { e.preventDefault(); this.toggle.emit(); }
  }

  // --- Footer (actuator hold) presentation — command phase overrides the resting
  //     hold hint so the operator sees Sending… / a refusal reason inline. --------
  /** Footer line: phase copy while a command resolves, else the hold affordance. */
  protected footerText = computed(() => {
    switch (this.phase()) {
      case 'pending': return 'Sending…';
      case 'refused': return this.reasonText();
      case 'expired': return 'No response';
      default:        return this.holdHint();
    }
  });
  protected footerTone = computed(() => {
    const c = this.cmd();
    if (c?.alert) return 'text-error';
    if (c?.spin) return 'text-warning';
    return this.held() ? 'text-primary font-medium' : 'text-base-content/50';
  });
  protected footerDot = computed(() => {
    if (this.cmd()?.alert) return 'bg-error';
    return this.held() ? 'bg-primary animate-pulse' : 'bg-base-content/30';
  });
  private reasonText(): string {
    const r = this.phaseReason();
    return r ? describeState(ANY_MEANING, r).label : 'Blocked — safety check';
  }

  protected statText = computed(() => {
    const r = this.row();
    return r ? fmt(r.reported) : '—';
  });

  /** Charted kinds show the span selector + history chart (line/flow only). */
  protected isCharted = computed(() => this.widget().kind === 'line' || this.widget().kind === 'flow');
  protected spanLabel = computed(() =>
    SPAN_PRESETS.find((p) => p.hours === this.span())?.label ?? `${this.span()}h`,
  );

  /** Water used over the selected window: the rate series integrated over time
   *  (see integrateLiters). Reboot-immune — no device counter to reset. null when
   *  there aren't two usable points to span. */
  protected windowUsed = computed<number | null>(() => integrateLiters(this.series()));
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
    if (!r) return { label: '—', cls: 'badge-ghost' };
    // Free-text channel (e.g. ordered queue contents): a non-numeric shadow rides in
    // reported_text (bool channels publish 1/0, so theirs stays empty).
    if (r.reported_text) return { label: r.reported_text, cls: 'badge-ghost' };
    // Boolean channel (pump / dosing / safety override): on/off via the shared rule.
    return this.isOn() ? { label: 'On', cls: 'badge-success' } : { label: 'Off', cls: 'badge-ghost' };
  });

  /** Canonical on/off: the shared node projection (`state`) when this card maps to
   *  a node, else the relay-shadow threshold. One definition of "on", shared with
   *  the live map, instead of re-deriving `reported >= 0.5` per card. */
  protected isOn = computed<boolean>(() => {
    const s = this.state();
    if (s) return s === 'on';
    const r = this.row();
    return !!r && r.reported >= 0.5;
  });

  /** Pump on/off → label, sub-line, colour. Mirrors `valve()` so the pump control
   *  tile reads the same as the valve one. */
  protected pump = computed<{ on: boolean; label: string; sub: string; text: string }>(() =>
    this.isOn()
      ? { on: true, label: 'On', sub: 'running', text: 'text-success' }
      : { on: false, label: 'Off', sub: 'stopped', text: 'text-base-content/50' },
  );

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
      // Extra bottom room for the zoom slider, matching the tank chart.
      grid: { left: 44, right: 12, top: 12, bottom: 40 },
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
      // Drag/scroll to zoom the time window (same affordance as the tank chart).
      dataZoom: [
        { type: 'inside', throttle: 50 },
        {
          type: 'slider', height: 16, bottom: 6,
          borderColor: 'transparent',
          fillerColor: 'rgba(34,211,238,0.15)',
          handleStyle: { color: CHART.accent },
          textStyle: { color: CHART.label },
          dataBackground: { lineStyle: { color: CHART.axis }, areaStyle: { color: 'rgba(34,211,238,0.08)' } },
        },
      ],
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

  /** Activity-rail dot colour: a failed command or fault is red, otherwise the
   *  token's severity (active green / warn amber), else a neutral dot. */
  protected dotClass(it: ActivityItem): string {
    if (it.ok === false) return 'bg-error';
    return DOT_CLASS[it.token ? describeState(ANY_MEANING, it.token).kind : 'normal'] ?? 'bg-base-content/25';
  }

  /** Inline token colour matching the rail dot, for the state/outcome word. */
  protected tokenClass(token: string): string {
    return TOKEN_CLASS[describeState(ANY_MEANING, token).kind] ?? 'text-base-content/40';
  }

  protected shortTime(ts: string): string {
    const d = new Date(ts);
    return Number.isNaN(d.getTime()) ? ts : d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }

  /** The initiator chip text via the shared {@link formatInitiator} vocabulary, so
   *  a command and a route transition read the same. A support action (admin-on-
   *  behalf) keeps its own warning chip and passes its label through unchanged. */
  protected actorText(it: ActivityItem): string {
    if (it.bySupport) return it.actor ?? '';
    return formatInitiator(it.origin, it.actor);
  }
}
