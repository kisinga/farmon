import { Component, computed, input, output } from '@angular/core';
import { describeState, routeLabel, FAULT_MEANINGS, STOP_REASON_MEANINGS, type RouteControl, type CommandPhase } from '@core';
import { phaseUi } from './command-phase';

/** The command a route card emits when toggled — a subset of CommandAction. */
export type RouteAction = 'route_start' | 'route_stop' | 'fault_reset';

/** A route's `reason` token is a fault or stop-reason — combined for lookup. */
const ROUTE_REASONS = { ...FAULT_MEANINGS, ...STOP_REASON_MEANINGS };

/** The state-derived presentation of a route card: copy, colours, the central
 *  control's morph state, the pipe animation, and which command a click sends. */
interface RouteView {
  label: string;
  /** True while the route is doing something (preparing/running/stopping); also
   *  drives the pipe animation. */
  running: boolean;
  /** Pulse the small state dot (transient states). */
  pulse: boolean;
  /** Central glyph — cross-fades between these on a state transition. */
  glyph: 'play' | 'stop' | 'reset';
  /** Spinner arc around the button (working: starting / stopping). */
  spin: boolean;
  /** Completed progress ring around the button (running / fault). */
  ringFull: boolean;
  /** Tint filling the pipe while active. */
  pipeFill: string;
  /** Card ring colour. */
  ring: string;
  textCls: string;
  dotCls: string;
  actionLabel: string;
  actionIcon: string;
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
    <button
      type="button"
      class="group relative isolate w-full text-left bg-base-100 rounded-2xl ring-1 transition-all overflow-hidden
             p-4 min-h-[140px] flex flex-col gap-2 disabled:cursor-not-allowed"
      [class]="cmd()?.alert ? 'ring-error/60' : view().ring"
      [class.opacity-60]="!online()"
      [disabled]="disabled()"
      [title]="title()"
      (click)="action.emit(view().action)">

      <!-- faint running glow so an active route visibly stands out -->
      @if (view().running) {
        <span class="pointer-events-none absolute -top-12 -right-8 w-40 h-40 rounded-full {{ view().textCls }} opacity-10 blur-2xl"
              [style.backgroundColor]="'currentColor'"></span>
      }

      <!-- state + action affordance (single line; label truncates so the card
           height never changes between states) -->
      <div class="relative flex items-center justify-between gap-2">
        <span class="inline-flex items-center gap-1.5 min-w-0 text-xs font-semibold {{ cmd()?.tone || view().textCls }}">
          <span class="w-1.5 h-1.5 rounded-full shrink-0 {{ view().dotCls }}" [class.animate-pulse]="view().pulse"></span>
          <span class="truncate">{{ labelText() }}</span>
        </span>
        @if (controllable() && online()) {
          <span class="shrink-0 text-[11px] font-semibold {{ view().textCls }} opacity-70 group-hover:opacity-100 inline-flex items-center gap-1">
            {{ view().actionIcon }} {{ view().actionLabel }}
          </span>
        } @else if (!online()) {
          <span class="shrink-0 text-[11px] text-base-content/40">offline</span>
        }
      </div>

      <!-- source ─[ flow ]─ destination as ONE continuous channel: the labels
           overlap the pipe ends and a light sheen sweeps left→right while
           active, so it reads as water moving from source to destination. -->
      <div class="relative flex-1 min-h-[64px]">
        <!-- pipe channel: fills with tinted water + a sweeping sheen when active -->
        <span class="absolute inset-x-0 top-1/2 -translate-y-1/2 h-2.5 rounded-full overflow-hidden transition-colors duration-500
                     {{ view().running ? view().pipeFill : 'bg-base-300/40' }}">
          @if (view().running) {
            <span class="absolute inset-y-0 left-0 w-1/3 bg-gradient-to-r from-transparent via-white/55 to-transparent flow-sheen-band"></span>
          }
        </span>

        <!-- source label, overlapping the channel's left end. A blurred, slightly
             opaque backing smudges the pipe behind it and lifts text contrast. -->
        <span class="absolute left-0 top-1/2 -translate-y-1/2 z-10 max-w-[40%] truncate px-1.5 py-0.5 rounded-lg
                     bg-base-100/45 backdrop-blur-[3px] text-sm sm:text-base font-bold tracking-tight [text-shadow:0_1px_2px_rgba(0,0,0,0.7)]"
              [title]="route().source || ''">{{ route().source || '—' }}</span>

        <!-- central control — a button whose glyph morphs play↔stop, with a
             spinner arc while starting/stopping and a full ring while running -->
        <span class="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-10 grid place-items-center
                     w-12 h-12 rounded-full bg-base-100 shadow-lg shadow-black/30 transition-all duration-300
                     group-hover:scale-105 {{ view().textCls }}">
          <!-- progress / activity ring -->
          <svg class="col-start-1 row-start-1 w-full h-full" [class.animate-spin]="view().spin || cmd()?.spin" viewBox="0 0 48 48" fill="none">
            <circle cx="24" cy="24" r="20" stroke="currentColor" stroke-opacity="0.18" stroke-width="3" />
            @if (view().spin || cmd()?.spin) {
              <circle cx="24" cy="24" r="20" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-dasharray="30 126" />
            } @else if (view().ringFull) {
              <circle cx="24" cy="24" r="20" stroke="currentColor" stroke-width="3" stroke-linecap="round" />
            }
          </svg>
          <!-- morphing glyphs (stacked; cross-fade + scale on transition) -->
          <svg class="col-start-1 row-start-1 h-5 w-5 translate-x-px transition-all duration-300 {{ view().glyph === 'play' ? 'opacity-100 scale-100' : 'opacity-0 scale-50' }}" viewBox="0 0 16 16" fill="currentColor"><path d="M5 3.5 L12.5 8 L5 12.5 Z" /></svg>
          <svg class="col-start-1 row-start-1 h-4 w-4 transition-all duration-300 {{ view().glyph === 'stop' ? 'opacity-100 scale-100' : 'opacity-0 scale-50' }}" viewBox="0 0 16 16" fill="currentColor"><rect x="3" y="3" width="10" height="10" rx="2.5" /></svg>
          <svg class="col-start-1 row-start-1 h-5 w-5 transition-all duration-300 {{ view().glyph === 'reset' ? 'opacity-100 scale-100' : 'opacity-0 scale-50' }}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 1 0 3-6.708L3 8" /><path d="M3 3v5h5" /></svg>
        </span>

        <!-- destination label, overlapping the channel's right end (same blurred
             contrast backing as the source). -->
        <span class="absolute right-0 top-1/2 -translate-y-1/2 z-10 max-w-[40%] truncate text-right px-1.5 py-0.5 rounded-lg
                     bg-base-100/45 backdrop-blur-[3px] text-sm sm:text-base font-bold tracking-tight [text-shadow:0_1px_2px_rgba(0,0,0,0.7)]"
              [title]="route().destination || ''">{{ route().destination || '—' }}</span>
      </div>

      <!-- live flow rate — the row is always present (fixed height) so the card
           never changes height between idle and running. -->
      <div class="relative flex items-center justify-center gap-2 h-5">
        @if (view().running && route().flowSensor && flowRate() !== null) {
          <span class="text-sm font-semibold tabular-nums {{ view().textCls }}">{{ flowText() }}<span class="text-[10px] font-normal text-base-content/40 ml-0.5">L/min</span></span>
        }
        @if (originText()) {
          <span class="text-[10px] text-base-content/40 truncate max-w-[60%]" [title]="originText()">{{ originText() }}</span>
        }
      </div>
    </button>
  `,
})
export class RouteCardComponent {
  readonly route = input.required<RouteControl>();
  /** The route's live state: a SYSTEM_STATE `token` ('' ⇒ never seen ⇒ idle), the
   *  `reason` token carried by the latest transition (for the fault detail), and
   *  who/what started the run (`origin` + resolved `actorLabel`). */
  readonly state = input<{ token: string; reason: string; origin?: string; actorLabel?: string }>({ token: '', reason: '' });

  /** "by Jane" / "Automation: Morning" while a run is active, else ''. */
  protected originText = computed(() => {
    const s = this.state();
    if (!s.token || s.token === 'IDLE') return '';
    if (s.origin === 'AUTOMATION') return s.actorLabel ? `Automation: ${s.actorLabel}` : 'Automation';
    if (s.origin === 'MANUAL') return s.actorLabel ? `by ${s.actorLabel}` : 'Manual';
    return '';
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
          glyph: 'play', spin: true, ringFull: false, pipeFill: 'bg-warning/25',
          ring: 'ring-warning/40', textCls: 'text-warning', dotCls: 'bg-warning',
          actionLabel: 'Stop', actionIcon: '■', action: 'route_stop' };
      case 'RUNNING':
        return { label: 'Flowing', running: true, pulse: false,
          glyph: 'stop', spin: false, ringFull: true, pipeFill: 'bg-primary/25',
          ring: 'ring-primary/50', textCls: 'text-primary', dotCls: 'bg-primary',
          actionLabel: 'Stop', actionIcon: '■', action: 'route_stop' };
      case 'STOPPING':
        return { label: 'Stopping…', running: true, pulse: true,
          glyph: 'stop', spin: true, ringFull: false, pipeFill: 'bg-warning/25',
          ring: 'ring-warning/40', textCls: 'text-warning', dotCls: 'bg-warning',
          actionLabel: 'Stop', actionIcon: '■', action: 'route_stop' };
      case 'FAULT': {
        const r = this.state().reason;
        const label = r ? describeState(ROUTE_REASONS, r).label : 'Fault';
        return { label, running: false, pulse: true,
          glyph: 'reset', spin: false, ringFull: true, pipeFill: '',
          ring: 'ring-error/50', textCls: 'text-error', dotCls: 'bg-error',
          actionLabel: 'Reset', actionIcon: '↻', action: 'fault_reset' };
      }
      default: // '' or IDLE
        return { label: 'Idle', running: false, pulse: false,
          glyph: 'play', spin: false, ringFull: false, pipeFill: '',
          ring: 'ring-base-300/40 hover:ring-base-300/70', textCls: 'text-base-content/50',
          dotCls: 'bg-base-content/30',
          actionLabel: 'Start', actionIcon: '▶', action: 'route_start' };
    }
  });
}
