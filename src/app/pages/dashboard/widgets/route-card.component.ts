import { Component, computed, input, output } from '@angular/core';
import { describeState, routeLabel, FAULT_MEANINGS, STOP_REASON_MEANINGS, type RouteControl, type CommandPhase } from '@core';
import { phaseUi } from './command-phase';
import { formatInitiator } from './initiator';

/** The command a route card emits when toggled — a subset of CommandAction. */
export type RouteAction = 'route_start' | 'route_stop' | 'fault_reset';

/** A route's `reason` token is a fault or stop-reason — combined for lookup. */
const ROUTE_REASONS = { ...FAULT_MEANINGS, ...STOP_REASON_MEANINGS };

/** The state-derived presentation of a route card: copy, colours, the central
 *  control's morph state, and which command a click sends. */
interface RouteView {
  label: string;
  /** True while the route is doing something (preparing/running/stopping). */
  running: boolean;
  /** Pulse the small state dot (transient states). */
  pulse: boolean;
  /** Central glyph — cross-fades between these on a state transition. */
  glyph: 'play' | 'stop' | 'reset';
  /** Spinner arc around the button (working: starting / stopping). */
  spin: boolean;
  /** Completed progress ring around the button (running / fault). */
  ringFull: boolean;
  /** Card ring colour. */
  ring: string;
  textCls: string;
  dotCls: string;
  /** Verb for the tooltip ("tap to stop"). */
  actionLabel: string;
  action: RouteAction;
}

/**
 * One route, drawn as a `source → destination` pipe that animates when water is
 * flowing. The whole card is the control: click toggles the route (start when
 * idle, stop when running, reset when faulted). Colour + words + the flow
 * animation all track the live state. Presentational — the page wires the state
 * (from the transition log) and the live flow rate, and handles the emitted
 * action.
 */
@Component({
  selector: 'app-route-card',
  standalone: true,
  template: `
    <!-- Compact strip: control · source → destination · state/flow, on one row.
         The morphing control button is the action affordance (play↔stop↔reset);
         colours, dot and ring all track live state. Folds three per row so the
         live system map above stays the hero. -->
    <button
      type="button"
      class="group relative isolate w-full text-left bg-base-100 rounded-xl ring-1 transition-all overflow-hidden
             px-3 py-2 flex items-center gap-3 disabled:cursor-not-allowed"
      [class]="cmd()?.alert ? 'ring-error/60' : view().ring"
      [class.opacity-60]="!online()"
      [disabled]="disabled()"
      [title]="title()"
      (click)="action.emit(view().action)">

      <!-- control — compact morphing glyph (play↔stop↔reset) with the same rings -->
      <span class="relative shrink-0 grid place-items-center w-9 h-9 rounded-full bg-base-100 ring-1 ring-base-300/40
                   transition-all group-hover:scale-105 {{ view().textCls }}">
        <svg class="col-start-1 row-start-1 w-full h-full" [class.animate-spin]="view().spin || cmd()?.spin" viewBox="0 0 48 48" fill="none">
          <circle cx="24" cy="24" r="20" stroke="currentColor" stroke-opacity="0.18" stroke-width="3" />
          @if (view().spin || cmd()?.spin) {
            <circle cx="24" cy="24" r="20" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-dasharray="30 126" />
          } @else if (view().ringFull) {
            <circle cx="24" cy="24" r="20" stroke="currentColor" stroke-width="3" stroke-linecap="round" />
          }
        </svg>
        <svg class="col-start-1 row-start-1 h-4 w-4 translate-x-px transition-all duration-300 {{ view().glyph === 'play' ? 'opacity-100 scale-100' : 'opacity-0 scale-50' }}" viewBox="0 0 16 16" fill="currentColor"><path d="M5 3.5 L12.5 8 L5 12.5 Z" /></svg>
        <svg class="col-start-1 row-start-1 h-3.5 w-3.5 transition-all duration-300 {{ view().glyph === 'stop' ? 'opacity-100 scale-100' : 'opacity-0 scale-50' }}" viewBox="0 0 16 16" fill="currentColor"><rect x="3" y="3" width="10" height="10" rx="2.5" /></svg>
        <svg class="col-start-1 row-start-1 h-4 w-4 transition-all duration-300 {{ view().glyph === 'reset' ? 'opacity-100 scale-100' : 'opacity-0 scale-50' }}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 1 0 3-6.708L3 8" /><path d="M3 3v5h5" /></svg>
      </span>

      <!-- source → destination + state line. The morphing control IS the action
           affordance, so no separate Start/Stop label — keeps the strip narrow
           enough for three per row. -->
      <span class="min-w-0 flex-1 flex flex-col gap-0.5">
        <span class="flex items-center gap-1 min-w-0 text-[13px] font-bold tracking-tight leading-tight">
          <span class="truncate" [title]="route().source || ''">{{ route().source || '—' }}</span>
          <svg class="shrink-0 h-3 w-3 text-base-content/40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14M13 6l6 6-6 6"/></svg>
          <span class="truncate" [title]="route().destination || ''">{{ route().destination || '—' }}</span>
        </span>
        <span class="inline-flex items-center gap-1.5 min-w-0 text-[11px] font-semibold leading-tight {{ cmd()?.tone || view().textCls }}">
          <span class="w-1.5 h-1.5 rounded-full shrink-0 {{ view().dotCls }}" [class.animate-pulse]="view().pulse"></span>
          <span class="truncate">{{ labelText() }}</span>
          @if (originText()) {
            <span class="text-base-content/40 font-normal truncate cursor-help" [title]="originTitle()">· {{ originText() }}</span>
          }
        </span>
      </span>

      <!-- live flow rate (running) or an offline marker -->
      @if (view().running && route().flowSensor && flowRate() !== null) {
        <span class="shrink-0 text-right text-sm font-semibold tabular-nums {{ view().textCls }}">{{ flowText() }}<span class="block text-[9px] font-normal text-base-content/40 -mt-0.5">L/min</span></span>
      } @else if (!online()) {
        <span class="shrink-0 text-[10px] text-base-content/40">offline</span>
      }
    </button>
  `,
})
export class RouteCardComponent {
  readonly route = input.required<RouteControl>();
  /** The route's live state: a SYSTEM_STATE `token` ('' ⇒ never seen ⇒ idle), the
   *  `reason` token carried by the latest transition (for the fault detail), and
   *  who/what started the run (`origin` + the viewer-resolved `initiator`). */
  readonly state = input<{ token: string; reason: string; origin?: string; initiator?: { label: string; support: boolean; title: string } }>({ token: '', reason: '' });

  /** "by Jane" / "Automation: Morning" / "Support" while a run is active, else ''.
   *  Mirrors the activity chip (resolveInitiator → formatInitiator) so the card and
   *  the timeline never disagree on who's running it. */
  protected originText = computed(() => {
    const s = this.state();
    if (!s.token || s.token === 'IDLE') return '';
    const init = s.initiator;
    if (!init || !init.label) return '';
    if (init.support) return init.label;
    return formatInitiator(s.origin, init.label);
  });
  /** Hover detail for the initiator line — name · email · co-owner / Support
   *  explainer, resolved alongside the label so it matches the activity chip. */
  protected originTitle = computed(() => {
    const s = this.state();
    if (!s.token || s.token === 'IDLE') return '';
    return s.initiator?.title ?? '';
  });
  /** Live flow rate (L/min) from the route's flow sensor, or null when unknown. */
  readonly flowRate = input<number | null>(null);
  readonly online = input(true);
  /** Live command phase from the lifecycle store; null ⇒ no command in flight (the
   *  state view drives). `pending` ⇒ "Sending…" + spinner; `refused`/`expired` ⇒
   *  surface the reason. */
  readonly phase = input<CommandPhase | null>(null);
  /** Refusal/stop reason token accompanying a `refused` phase (best-effort). */
  readonly phaseReason = input('');
  /** False (admin read-only) → state still shows, the toggle is disabled. */
  readonly controllable = input(true);

  readonly action = output<RouteAction>();

  protected disabled = computed(() => this.phase() === 'pending' || !this.online() || !this.controllable());

  /** Command-phase overlay (spinner / alert) layered over the token-driven view. */
  protected cmd = computed(() => { const p = this.phase(); return p ? phaseUi(p) : null; });

  /** State line text: the command phase wins while a command resolves (instant
   *  "Sending…", then the reason on refusal/timeout), else the token-derived label. */
  protected labelText = computed(() => {
    switch (this.phase()) {
      case 'pending': return 'Sending…';
      case 'refused': return this.reasonLabel();
      case 'expired': return 'No response';
      default:        return this.view().label;
    }
  });

  private reasonLabel(): string {
    const r = this.phaseReason();
    return r ? describeState(ROUTE_REASONS, r).label : 'Blocked';
  }

  protected flowText(): string {
    const v = this.flowRate();
    if (v === null || Number.isNaN(v)) return '—';
    return v >= 100 || Number.isInteger(v) ? String(Math.round(v)) : v.toFixed(1);
  }

  protected title = computed(() => {
    const v = this.view();
    const parts = [`${routeLabel(this.route(), this.route().routeId)}: ${v.label}`];
    const reason = this.state().reason;
    if (reason) parts.push(describeState(ROUTE_REASONS, reason).label);
    if (!this.online()) parts.push('controller offline');
    else if (!this.controllable()) parts.push('read-only');
    else parts.push(`tap to ${v.actionLabel.toLowerCase()}`);
    return parts.join(' · ');
  });

  protected view = computed<RouteView>(() => {
    const token = this.state().token;
    switch (token) {
      case 'PREPARING':
        return { label: 'Starting…', running: true, pulse: true,
          glyph: 'play', spin: true, ringFull: false,
          ring: 'ring-warning/40', textCls: 'text-warning', dotCls: 'bg-warning',
          actionLabel: 'Stop', action: 'route_stop' };
      case 'RUNNING':
        return { label: 'Flowing', running: true, pulse: false,
          glyph: 'stop', spin: false, ringFull: true,
          ring: 'ring-primary/50', textCls: 'text-primary', dotCls: 'bg-primary',
          actionLabel: 'Stop', action: 'route_stop' };
      case 'STOPPING':
        return { label: 'Stopping…', running: true, pulse: true,
          glyph: 'stop', spin: true, ringFull: false,
          ring: 'ring-warning/40', textCls: 'text-warning', dotCls: 'bg-warning',
          actionLabel: 'Stop', action: 'route_stop' };
      case 'FAULT': {
        const r = this.state().reason;
        const label = r ? describeState(ROUTE_REASONS, r).label : 'Fault';
        return { label, running: false, pulse: true,
          glyph: 'reset', spin: false, ringFull: true,
          ring: 'ring-error/50', textCls: 'text-error', dotCls: 'bg-error',
          actionLabel: 'Reset', action: 'fault_reset' };
      }
      default: // '' or IDLE
        return { label: 'Idle', running: false, pulse: false,
          glyph: 'play', spin: false, ringFull: false,
          ring: 'ring-base-300/40 hover:ring-base-300/70', textCls: 'text-base-content/50',
          dotCls: 'bg-base-content/30',
          actionLabel: 'Start', action: 'route_start' };
    }
  });
}
