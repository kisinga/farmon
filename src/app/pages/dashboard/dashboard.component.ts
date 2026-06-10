import { Component, OnDestroy, computed, inject, signal } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { buildDashboardSpec, parseTopology, COMMAND_TTL_S, type CommandAction, type DashboardWidget, type ActuatorControl, type AutomationControl } from '@core';
import { BackendService } from '../../core/services/backend.service';
import { AuthStore } from '../../core/services/auth.store';
import { ConfirmService } from '../../core/services/confirm.service';
import { DashboardStore } from './dashboard.store';
import { TelemetryStore } from './telemetry.store';
import { DashboardCardComponent } from './widgets/dashboard-card.component';
import { RouteCardComponent } from './widgets/route-card.component';
import type { RouteControl } from '@core';

/**
 * Customer dashboard for a site (`/site/:name/dashboard`, where `:name` is the
 * site id). Builds the chart spec in the browser from the saved topology, then
 * renders live widgets from the shadow + transition log, a per-controller
 * command bar, and a manual-control panel. Runtime state group only — it must
 * not import the editor services (WorkspaceService / SystemEditorService).
 */
@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [DashboardCardComponent, RouteCardComponent],
  providers: [DashboardStore, TelemetryStore],
  host: { class: 'flex-1 overflow-auto' },
  template: `
    <div class="max-w-6xl mx-auto w-full px-4 sm:px-6 py-5 sm:py-6">
      <!-- Bright hero band -->
      <div class="relative overflow-hidden rounded-2xl mb-5 sm:mb-6 ring-1 ring-white/10
                  bg-gradient-to-br from-cyan-500/15 via-sky-500/10 to-base-100">
        <div class="pointer-events-none absolute -top-16 -right-10 w-72 h-72 rounded-full bg-cyan-500/20 blur-3xl"></div>
        <div class="relative px-4 py-5 sm:px-6 sm:py-6 flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-4">
          <div class="flex-1 min-w-0">
            <h1 class="text-xl sm:text-2xl font-bold tracking-tight leading-tight break-words">{{ siteName() || 'Dashboard' }}</h1>
            <p class="text-sm text-base-content/60 mt-0.5">Live status &amp; control</p>
          </div>
          <div class="flex items-center gap-2 flex-wrap shrink-0">
            <button class="btn btn-sm btn-ghost gap-1.5" (click)="openDocs()" [disabled]="docBusy()"
                    title="Open this site's documentation">
              @if (docBusy()) { <span class="loading loading-spinner loading-xs"></span> }
              @else {
                <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
                </svg>
              }
              Documentation
            </button>
            <!-- Real device presence (replaces the old hardcoded pill). -->
            @if (presenceTone() === 'online') {
              <span class="inline-flex items-center gap-1.5 text-xs text-success bg-success/10 rounded-full px-2.5 py-1">
                <span class="w-1.5 h-1.5 rounded-full bg-success animate-pulse"></span> {{ presenceLabel() }}
              </span>
            } @else if (presenceTone() === 'partial') {
              <span class="inline-flex items-center gap-1.5 text-xs text-warning bg-warning/10 rounded-full px-2.5 py-1">
                <span class="w-1.5 h-1.5 rounded-full bg-warning"></span> {{ presenceLabel() }}
              </span>
            } @else {
              <span class="inline-flex items-center gap-1.5 text-xs text-base-content/50 bg-base-content/10 rounded-full px-2.5 py-1">
                <span class="w-1.5 h-1.5 rounded-full bg-base-content/40"></span>
                {{ presenceLabel() }}@if (presenceDetail()) { <span class="opacity-70">· {{ presenceDetail() }}</span> }
              </span>
            }
          </div>
        </div>
      </div>

      @if (store.loading()) {
        <div class="flex items-center justify-center py-24"><span class="loading loading-spinner loading-lg"></span></div>
      } @else if (store.error()) {
        <div class="alert alert-error text-sm">{{ store.error() }}</div>
      } @else {
        <!-- Admin-viewing-a-customer-site banner: read-only by default, with an
             explicit Take control. Commands sent after taking control are
             recorded against the admin's account (issued_role audit). -->
        @if (adminViewing()) {
          <div class="alert mb-4 text-sm" [class]="controlEnabled() ? 'alert-warning' : 'alert-info'">
            <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
              @if (controlEnabled()) {
                <path stroke-linecap="round" stroke-linejoin="round" d="M12 9v4m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/>
              } @else {
                <path stroke-linecap="round" stroke-linejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z M2.46 12C3.73 7.94 7.52 5 12 5c4.48 0 8.27 2.94 9.54 7-1.27 4.06-5.06 7-9.54 7-4.48 0-8.27-2.94-9.54-7z"/>
              }
            </svg>
            <span class="flex-1">
              @if (controlEnabled()) {
                You have control of <strong>{{ siteName() }}</strong> (a customer's site). Commands you send are recorded against your account.
              } @else {
                Admin view — <strong>{{ siteName() }}</strong> is a customer's site. You're viewing read-only.
              }
            </span>
            @if (controlEnabled()) {
              <button class="btn btn-xs btn-ghost" (click)="controlEnabled.set(false)">Release control</button>
            } @else {
              <button class="btn btn-xs btn-warning" (click)="controlEnabled.set(true)">Take control</button>
            }
          </div>
        }

        <!-- Routes — the live control surface. Shown to everyone (status reads
             even in admin read-only); the toggle is disabled, not hidden, when
             control isn't held. Each card animates water when its route flows
             and toggles start/stop on click. -->
        @if (hasRoutes()) {
          <section class="mb-6">
            <h2 class="text-xs font-semibold uppercase tracking-wider text-base-content/40 mb-2.5">Routes</h2>
            @for (c of store.spec().controllers; track c.controller) {
              @if (c.routes.length) {
                <div class="mb-4 last:mb-0">
                  <div class="flex items-center gap-2 mb-2">
                    <span class="w-2 h-2 rounded-full shrink-0" [class]="store.presence(c.controller).online ? 'bg-success' : 'bg-base-content/30'"
                      [title]="store.presence(c.controller).online ? 'Online' : ('Offline · ' + lastSeenText(c.controller))"></span>
                    @if (showController()) { <span class="text-xs font-semibold text-base-content/60">{{ c.name }}</span> }
                    <span class="grow"></span>
                    @if (canControl()) {
                      <button class="btn btn-xs btn-error btn-outline" [disabled]="busy().has(key(c.controller,'stop_all'))"
                        (click)="cmd(c.controller,'stop_all')">Stop all</button>
                      <details class="dropdown dropdown-end">
                        <summary class="btn btn-xs btn-ghost" title="More controller actions">⋯</summary>
                        <ul class="dropdown-content menu menu-sm z-10 mt-1 w-40 rounded-box bg-base-100 ring-1 ring-base-300/40 shadow-lg p-1">
                          <li><button [disabled]="busy().has(key(c.controller,'reset_faults'))" (click)="cmd(c.controller,'reset_faults')">Reset faults</button></li>
                          <li><button [disabled]="busy().has(key(c.controller,'clear_queue'))" (click)="cmd(c.controller,'clear_queue')">Clear queue</button></li>
                        </ul>
                      </details>
                    }
                  </div>
                  <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                    @for (r of c.routes; track r.routeId) {
                      <app-route-card
                        [route]="r"
                        [state]="routeState(c.controller, r.routeId)"
                        [flowRate]="routeFlow(c.controller, r)"
                        [online]="store.presence(c.controller).online"
                        [busy]="routeBusy(c.controller, r.routeId)"
                        [controllable]="canControl()"
                        (action)="cmd(c.controller, $event, r.routeId)"
                      />
                    }
                  </div>
                </div>
              }
            }
          </section>
        }

        <!-- Schedules — pause/resume baked automations at runtime (over MQTT, no
             rebuild). Shown to everyone (state reads even in admin read-only);
             the toggle is disabled, not hidden, when control isn't held or the
             controller is offline. -->
        @if (hasAutomations()) {
          <section class="mb-6">
            <h2 class="text-xs font-semibold uppercase tracking-wider text-base-content/40 mb-2.5">Schedules</h2>
            @for (c of store.spec().controllers; track c.controller) {
              @if (c.automations.length) {
                <div class="mb-4 last:mb-0">
                  @if (showController()) {
                    <div class="flex items-center gap-2 mb-2">
                      <span class="w-2 h-2 rounded-full shrink-0" [class]="store.presence(c.controller).online ? 'bg-success' : 'bg-base-content/30'"></span>
                      <span class="text-xs font-semibold text-base-content/60">{{ c.name }}</span>
                    </div>
                  }
                  <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    @for (a of c.automations; track a.id) {
                      <div class="bg-base-100 rounded-2xl ring-1 ring-base-300/40 p-3.5 flex items-center gap-3"
                           [class.opacity-60]="!store.presence(c.controller).online">
                        <div class="min-w-0 flex-1">
                          <div class="flex items-center gap-1.5">
                            <span class="w-1.5 h-1.5 rounded-full shrink-0"
                                  [class]="automationEnabled(c.controller, a.enableSensor) ? 'bg-success' : 'bg-base-content/30'"></span>
                            <span class="text-sm font-semibold truncate">{{ a.name }}</span>
                          </div>
                          <p class="text-xs text-base-content/50 truncate mt-0.5">{{ a.trigger }} → {{ a.routeName }}</p>
                        </div>
                        <button class="btn btn-xs shrink-0 w-20"
                                [class]="automationEnabled(c.controller, a.enableSensor) ? 'btn-success btn-outline' : 'btn-ghost'"
                                [disabled]="!canControl() || !store.presence(c.controller).online || automationBusy(c.controller, a.id)"
                                (click)="toggleAutomation(c.controller, a)">
                          @if (automationBusy(c.controller, a.id)) { <span class="loading loading-spinner loading-xs"></span> }
                          @else { {{ automationEnabled(c.controller, a.enableSensor) ? 'On' : 'Paused' }} }
                        </button>
                      </div>
                    }
                  </div>
                  <p class="text-[11px] text-base-content/40 mt-1.5">Pausing stops future runs only; a route already running keeps going (use its Stop control).</p>
                </div>
              }
            }
          </section>
        }

        <!-- Commissioning (advanced): valves/pumps are held by tapping their card
             above; the only extra control here is the safety override. Hidden
             while an admin is read-only; collapsed by default. -->
        @if (canControl()) {
          @for (c of store.spec().controllers; track c.controller) {
            @if (c.actuators.length > 0) {
              <details class="mb-4 bg-base-100/60 rounded-2xl ring-1 ring-base-300/30 px-4 py-3">
                <summary class="cursor-pointer list-none flex items-center gap-2 text-xs font-semibold text-base-content/60">
                  <svg xmlns="http://www.w3.org/2000/svg" class="h-3.5 w-3.5 shrink-0 text-base-content/40" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                    <path stroke-linecap="round" stroke-linejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"/>
                    <path stroke-linecap="round" stroke-linejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"/>
                  </svg>
                  Commissioning@if (showController()) { <span class="text-base-content/40">· {{ c.name }}</span> }
                  <span class="text-[11px] font-normal text-base-content/40">advanced</span>
                </summary>
                <div class="mt-3 pt-3 border-t border-base-300/30 flex flex-col gap-2.5">
                  <p class="text-[11px] text-base-content/50">Tap a valve or pump card above to hold it open or running; it releases automatically if you disconnect.</p>
                  <div class="flex items-center gap-2">
                    <span class="text-xs text-base-content/60">Safety override</span>
                    <span class="grow"></span>
                    <button class="btn btn-xs" [class]="overrideOn(c.controller) ? 'btn-error' : 'btn-ghost'"
                      [disabled]="busy().has(manualKey(c.controller,'safety_override'))"
                      (click)="toggleOverride(c.controller)">
                      {{ overrideOn(c.controller) ? 'ON' : 'off' }}
                    </button>
                  </div>
                  @if (overrideOn(c.controller)) {
                    <p class="text-[11px] text-warning">Safety checks are OFF: a pump can run with no route and the watchdogs are bypassed. Turn this off when you finish.</p>
                  }
                </div>
              </details>
            }
          }
        }

        @if (note()) { <div class="text-xs text-base-content/50 mb-3">{{ note() }}</div> }

        <!-- Widgets, grouped into sections so status / levels / valves / flow /
             activity read as distinct zones instead of one jumbled grid. -->
        @for (sec of sections(); track sec.id) {
          <section class="mb-6">
            <h2 class="text-xs font-semibold uppercase tracking-wider text-base-content/40 mb-2.5">{{ sec.label }}</h2>
            <div [class]="gridFor(sec.id)">
              @for (w of sec.widgets; track w.id) {
                <div [class]="w.kind === 'timeline' ? 'sm:col-span-2 lg:col-span-3' : ''">
                  <app-dashboard-card
                    [widget]="w"
                    [dense]="denseSection(sec.id)"
                    [controllerLabel]="showController() ? ctrlName(w.controller) : ''"
                    [controllerColor]="ctrlColor(w.controller)"
                    [row]="store.rowFor(w)"
                    [totalRow]="store.row(w.controller, w.totalSensor)"
                    [series]="telemetry.seriesFor(w)"
                    [events]="store.eventsFor(w.controller)"
                    [actuatable]="isActuatable(w)"
                    [held]="actuatorHeld(w)"
                    [actuatorBusy]="actuatorBusyFor(w)"
                    [actuatorKind]="actuatorFor(w)?.kind ?? ''"
                    (toggle)="toggleWidgetActuator(w)"
                  />
                </div>
              }
            </div>
          </section>
        }
      }
    </div>
  `,
})
export class DashboardComponent implements OnDestroy {
  private route = inject(ActivatedRoute);
  private backend = inject(BackendService);
  private auth = inject(AuthStore);
  private confirm = inject(ConfirmService);
  protected store = inject(DashboardStore);
  protected telemetry = inject(TelemetryStore);

  private siteId = '';
  protected siteName = signal('');
  protected busy = signal<Set<string>>(new Set());
  protected note = signal<string | null>(null);
  /** Building/opening the site documentation. */
  protected docBusy = signal(false);

  /**
   * Assemble this site's documentation in the browser and open it in a new tab.
   * Uses the diagrams cached on the site (rendered admin-side), so no X6 here.
   */
  async openDocs(): Promise<void> {
    if (this.docBusy()) return;
    this.docBusy.set(true);
    this.note.set(null);
    try {
      const html = await this.backend.buildSiteDoc(this.siteId);
      const url = URL.createObjectURL(new Blob([html], { type: 'text/html' }));
      window.open(url, '_blank');
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (e) {
      this.note.set(String(e));
    } finally {
      this.docBusy.set(false);
    }
  }

  /** Stale-command window in minutes, for the offline warning copy. */
  private readonly ttlMin = Math.max(1, Math.round(COMMAND_TTL_S / 60));

  /** Actuators we are actively holding (heartbeating), keyed `${ctrl}::${node}`. */
  protected manualHeld = signal<Set<string>>(new Set());
  /** Re-claim timers for held actuators, same key — cleared on release/destroy. */
  private heartbeats = new Map<string, number>();
  /** When each actuator was first claimed — a grace window before reconciling its
   *  reported state (the device needs a tick or two to start + report). */
  private claimedAt = new Map<string, number>();
  /** Polls held actuators against their reported state to catch a device-side
   *  refusal/latch, so a blocked toggle stops showing "held". */
  private reconcileTimer?: number;

  /** True when an admin is viewing a site they don't own (support/validation). */
  protected adminViewing = signal(false);
  /** Admin opted into control on a non-owned site (audited via issued_role). */
  protected controlEnabled = signal(false);
  /** Command bar is shown to owners always, and to admins only after Take control. */
  protected canControl = computed(() => !this.adminViewing() || this.controlEnabled());

  /** Stable per-controller identity colours (matches the editor's palette feel). */
  private static readonly CTRL_COLORS = ['#22d3ee', '#34d399', '#fbbf24', '#a78bfa', '#f472b6', '#38bdf8'];

  /** id → { name, colour } for every controller in the spec. */
  private ctrlMeta = computed(() => {
    const m = new Map<string, { name: string; color: string }>();
    this.store.spec().controllers.forEach((c, i) =>
      m.set(c.controller, { name: c.name, color: DashboardComponent.CTRL_COLORS[i % DashboardComponent.CTRL_COLORS.length] }),
    );
    return m;
  });

  /** Only label widgets by controller when the site actually has more than one. */
  protected showController = computed(() => this.store.spec().controllers.length > 1);
  protected ctrlName(id: string): string { return this.ctrlMeta().get(id)?.name ?? id; }
  protected ctrlColor(id: string): string { return this.ctrlMeta().get(id)?.color ?? '#94a3b8'; }

  // --- Device presence (aggregate, for the hero pill) ----------------------
  private onlineCount = computed(() =>
    this.store.spec().controllers.filter((c) => this.store.presence(c.controller).online).length,
  );
  protected presenceTone = computed<'online' | 'offline' | 'partial'>(() => {
    const total = this.store.spec().controllers.length;
    if (total === 0) return 'offline';
    const on = this.onlineCount();
    return on === total ? 'online' : on === 0 ? 'offline' : 'partial';
  });
  protected presenceLabel = computed(() => {
    const total = this.store.spec().controllers.length;
    if (this.presenceTone() === 'online') return 'Live';
    if (this.presenceTone() === 'partial') return `${this.onlineCount()}/${total} online`;
    return 'Offline';
  });
  /** Single-controller offline detail ("last seen 3m ago"). */
  protected presenceDetail = computed(() => {
    const ctrls = this.store.spec().controllers;
    if (ctrls.length !== 1 || this.presenceTone() === 'online') return '';
    const seen = this.store.presence(ctrls[0].controller).lastSeen;
    return seen ? `last seen ${this.ago(seen)}` : '';
  });

  protected lastSeenText(controller: string): string {
    const seen = this.store.presence(controller).lastSeen;
    return seen ? this.ago(seen) : 'never seen';
  }

  private ago(ts: number): string {
    const s = Math.max(0, Math.round((this.store.now() - ts) / 1000));
    if (s < 60) return 'just now';
    const m = Math.round(s / 60);
    if (m < 60) return `${m}m ago`;
    return `${Math.round(m / 60)}h ago`;
  }

  /** Section a widget belongs to — drives the grouped layout below. Valves and
   *  pumps are the manual controls, so they share one section (kept out of the
   *  read-only status strip); structural `actuatorFor` (not online/control)
   *  decides, so cards don't jump sections when a device drops offline. */
  private category(w: DashboardWidget): 'status' | 'levels' | 'valves' | 'flow' | 'pressure' | 'activity' {
    if (w.kind === 'timeline') return 'activity';
    if (w.kind === 'valve' || this.actuatorFor(w)) return 'valves'; // valves + pumps = controls
    switch (w.kind) {
      case 'gauge':    return 'levels';
      case 'flow':     return 'flow';
      case 'line':     return 'pressure'; // remaining line charts are pressure/filter (psi)
      case 'stat':     return w.unit === 'L' ? 'flow' : 'status'; // stray flow totals vs queue depth
      default:         return 'status'; // badges: system state, last stop, override
    }
  }

  /** Widgets grouped into ordered, labelled sections (empty sections dropped). */
  protected sections = computed(() => {
    const labels: Record<string, string> = {
      status: 'Status', levels: 'Tank levels', valves: 'Valves',
      flow: 'Flow', pressure: 'Pressure', activity: 'Activity',
    };
    const order = ['status', 'levels', 'valves', 'flow', 'pressure', 'activity'] as const;
    const byCat = new Map<string, DashboardWidget[]>();
    for (const w of this.store.spec().widgets) {
      const cat = this.category(w);
      const arr = byCat.get(cat) ?? [];
      arr.push(w);
      byCat.set(cat, arr);
    }
    return order.filter((c) => byCat.has(c)).map((c) => {
      const widgets = byCat.get(c)!;
      let label = labels[c];
      if (c === 'valves') {
        const hasValve = widgets.some((w) => w.kind === 'valve');
        const hasPump = widgets.some((w) => w.kind !== 'valve'); // pumps grouped here
        label = hasValve && hasPump ? 'Valves & pumps' : hasPump ? 'Pumps' : 'Valves';
      }
      return { id: c, label, widgets };
    });
  });

  // --- Routes (the live control surface) -----------------------------------
  protected hasRoutes = computed(() => this.store.spec().controllers.some((c) => c.routes.length > 0));

  // --- Schedules (runtime pause/resume of baked automations) ---------------
  protected hasAutomations = computed(() => this.store.spec().controllers.some((c) => c.automations.length > 0));

  private automationKey(controller: string, id: string): string {
    return `${controller}/automation_set/${id}`;
  }

  /** Live enabled state from the shadow (the device's enable switch). Defaults to
   *  ON when never reported — baked schedules ship enabled (RESTORE_DEFAULT_ON),
   *  so "not yet seen" reads as on, not a misleading paused. */
  protected automationEnabled(controller: string, enableSensor: string): boolean {
    const r = this.store.row(controller, enableSensor);
    return r ? r.reported >= 0.5 : true;
  }

  protected automationBusy(controller: string, id: string): boolean {
    return this.busy().has(this.automationKey(controller, id));
  }

  /** Pause/resume a baked schedule. Pausing suppresses future triggers only — if
   *  the schedule's route is running right now, say so (the run keeps going). */
  protected async toggleAutomation(controller: string, auto: AutomationControl): Promise<void> {
    if (!this.canControl()) return;
    const on = !this.automationEnabled(controller, auto.enableSensor);
    const token = this.routeState(controller, auto.routeId).token;
    const running = token === 'PREPARING' || token === 'RUNNING' || token === 'STOPPING';
    const ok = await this.run(controller, 'automation_set', { automationId: auto.id, on }, this.automationKey(controller, auto.id));
    // Replace run()'s generic "sent" note with the behaviour-specific one when a
    // pause lands while the schedule's route is mid-run.
    if (ok && !on && running) {
      this.note.set(`Schedule paused. "${auto.routeName}" is running now and keeps going; use its Stop control to end it.`);
    }
  }

  /** A route's live state for its card (token + reason; empty when never seen). */
  protected routeState(controller: string, routeId: number): { token: string; reason: string } {
    const s = this.store.routeState(controller, routeId);
    return { token: s?.token ?? '', reason: s?.reason ?? '' };
  }

  /** Live flow rate (L/min) for a route's primary flow sensor, null when none/unknown. */
  protected routeFlow(controller: string, r: RouteControl): number | null {
    if (!r.flowSensor) return null;
    return this.store.row(controller, r.flowSensor)?.reported ?? null;
  }

  /** A start/stop/fault-reset for this route is in flight (disables the card). */
  protected routeBusy(controller: string, routeId: number): boolean {
    const b = this.busy();
    return b.has(this.key(controller, 'route_start', routeId))
      || b.has(this.key(controller, 'route_stop', routeId))
      || b.has(this.key(controller, 'fault_reset', routeId));
  }

  // --- Widget section layout -----------------------------------------------
  /** Valves + the status strip render as a dense glyph grid; everything else as
   *  full cards. */
  protected denseSection(id: string): boolean { return id === 'status' || id === 'valves'; }
  protected gridFor(id: string): string {
    if (id === 'status') return 'grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2';
    if (id === 'valves') return 'grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2';
    // Activity is a text log — cap its width so rows stay readable and the
    // timestamp isn't marooned across a full-width card.
    if (id === 'activity') return 'grid grid-cols-1 gap-4 max-w-2xl';
    return 'grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4';
  }

  // --- Inline actuator control --------------------------------------------
  // A valve/pump widget reads the same sensor its actuator reports on, so the
  // status card *is* the control: click to hold open / run (claim) or release.
  // This replaces the separate manual-control button cluster.
  /** `${controller}/${reportedSensor}` → the actuator it drives. */
  private actuatorMap = computed(() => {
    const m = new Map<string, ActuatorControl>();
    for (const c of this.store.spec().controllers)
      for (const a of c.actuators) m.set(`${c.controller}/${a.reportedSensor}`, a);
    return m;
  });
  protected actuatorFor(w: DashboardWidget): ActuatorControl | undefined {
    return w.sensor ? this.actuatorMap().get(`${w.controller}/${w.sensor}`) : undefined;
  }
  /** Toggleable now: an actuator exists, control is held, and the device is online. */
  protected isActuatable(w: DashboardWidget): boolean {
    return this.canControl() && !!this.actuatorFor(w) && this.store.presence(w.controller).online;
  }
  protected actuatorHeld(w: DashboardWidget): boolean {
    const a = this.actuatorFor(w);
    return a ? this.isHeld(w.controller, a.id) : false;
  }
  protected actuatorBusyFor(w: DashboardWidget): boolean {
    const a = this.actuatorFor(w);
    return a ? this.busy().has(this.manualKey(w.controller, a.id)) : false;
  }
  protected toggleWidgetActuator(w: DashboardWidget): void {
    const a = this.actuatorFor(w);
    if (a) void this.toggleActuator(w.controller, a.id);
  }

  constructor() {
    this.siteId = this.route.snapshot.paramMap.get('name') ?? '';
    if (this.siteId) void this.load();
    this.reconcileTimer = window.setInterval(() => this.reconcileHeld(), 3000);
  }

  ngOnDestroy(): void {
    for (const h of this.heartbeats.values()) clearInterval(h);
    this.heartbeats.clear();
    if (this.reconcileTimer) clearInterval(this.reconcileTimer);
  }

  private async load(): Promise<void> {
    const { site, topology } = await this.backend.siteLoad(this.siteId);
    this.siteName.set(site.friendlyName);
    // Admin looking at a site they don't own → start read-only.
    this.adminViewing.set(this.auth.isAdmin() && site.owner !== this.auth.user()?.id);
    if (!topology) {
      this.store.error.set('Site has no topology yet.');
      this.store.loading.set(false);
      return;
    }
    const spec = buildDashboardSpec(parseTopology(topology));
    await this.store.init(this.siteId, spec);
    // Backfill history for the charted widgets (line + flow rate).
    for (const w of spec.widgets) {
      if (w.kind === 'line' || w.kind === 'flow') void this.telemetry.load(this.siteId, w);
    }
  }

  protected key(controller: string, action: CommandAction, routeId?: number): string {
    return `${controller}/${action}/${routeId ?? ''}`;
  }

  protected manualKey(controller: string, node: string): string {
    return `${controller}::${node}`;
  }

  protected isHeld(controller: string, node: string): boolean {
    return this.manualHeld().has(this.manualKey(controller, node));
  }

  /** Safety override reported state, read from the shadow (the device switch). */
  protected overrideOn(controller: string): boolean {
    const r = this.store.row(controller, 'safety_override');
    return !!r && r.reported >= 0.5;
  }

  /** Send a command + reconcile the note (warns when the target reads offline). */
  private async run(
    controller: string,
    action: CommandAction,
    args: { routeId?: number; nodeId?: string; automationId?: string; on?: boolean },
    busyKey: string,
  ): Promise<boolean> {
    if (!this.canControl()) return false;
    this.busy.update((s) => new Set(s).add(busyKey));
    this.note.set(null);
    try {
      await this.backend.sendCommand(this.siteId, controller, action, args);
      this.note.set(
        this.store.presence(controller).online
          ? `Sent to ${this.ctrlName(controller)} — watching for the device to confirm.`
          : `${this.ctrlName(controller)} looks offline — the command expires in ~${this.ttlMin} min if it doesn't reconnect.`,
      );
      return true;
    } catch (err) {
      this.note.set(String(err));
      return false;
    } finally {
      this.busy.update((s) => {
        const n = new Set(s);
        n.delete(busyKey);
        return n;
      });
    }
  }

  protected async cmd(controller: string, action: CommandAction, routeId?: number): Promise<void> {
    await this.run(controller, action, { routeId }, this.key(controller, action, routeId));
  }

  /** Toggle a manual claim on an actuator. On → claim + heartbeat; off → release. */
  protected async toggleActuator(controller: string, node: string): Promise<void> {
    const key = this.manualKey(controller, node);
    if (this.manualHeld().has(key)) {
      this.stopHeartbeat(key);
      this.claimedAt.delete(key);
      this.manualHeld.update((s) => { const n = new Set(s); n.delete(key); return n; });
      await this.run(controller, 'node_set', { nodeId: node, on: false }, key);
    } else if (await this.run(controller, 'node_set', { nodeId: node, on: true }, key)) {
      this.claimedAt.set(key, Date.now());
      this.manualHeld.update((s) => new Set(s).add(key));
      this.startHeartbeat(controller, node, key);
    }
  }

  /** Find the actuator + its controller for a manual-hold key. */
  private actuatorByKey(key: string): { controller: string; actuator: ActuatorControl } | undefined {
    for (const c of this.store.spec().controllers)
      for (const actuator of c.actuators)
        if (this.manualKey(c.controller, actuator.id) === key) return { controller: c.controller, actuator };
    return undefined;
  }

  /** Locally drop a hold the device refused/latched: stop heartbeat + tell the
   *  device to release (which clears its latch so a retry starts clean). */
  private releaseHeld(controller: string, node: string, key: string): void {
    this.stopHeartbeat(key);
    this.claimedAt.delete(key);
    this.manualHeld.update((s) => { const n = new Set(s); n.delete(key); return n; });
    void this.backend.sendCommand(this.siteId, controller, 'node_set', { nodeId: node, on: false }).catch(() => {});
  }

  /** Poll: an ONLINE controller reporting a held actuator OFF (past the start
   *  grace) means a safety guard refused/latched it — revert the toggle so it
   *  stops lying, and surface why. Offline controllers are left alone (can't judge;
   *  the device's dead-man lease is the safety there). */
  private reconcileHeld(): void {
    const held = this.manualHeld();
    if (held.size === 0) return;
    const now = Date.now();
    for (const key of held) {
      if (now - (this.claimedAt.get(key) ?? 0) < 8000) continue;
      const found = this.actuatorByKey(key);
      if (!found || !this.store.presence(found.controller).online) continue;
      const row = this.store.row(found.controller, found.actuator.reportedSensor);
      if (row && row.reported >= 0.5) continue; // actually running — fine
      this.releaseHeld(found.controller, found.actuator.id, key);
      this.note.set(`${found.actuator.name} on ${this.ctrlName(found.controller)} stopped — blocked by a safety check (no flow, source low, or runtime). See Activity. Safety override is commissioning-only.`);
    }
  }

  /** Toggle the commissioning safety-override switch; enabling it is gated by a
   *  hard confirm (it disables every runtime safety check). */
  protected async toggleOverride(controller: string): Promise<void> {
    if (!this.canControl()) return;
    const turningOn = !this.overrideOn(controller);
    if (turningOn) {
      const ok = await this.confirm.confirm({
        title: 'Disable all safety checks?',
        message: `Safety override turns OFF every runtime safety check on ${this.ctrlName(controller)}: tank-level gates, the no-flow watchdog, runtime level stops and the max-runtime limit. A pump can run with no route and no protection. Use it only for commissioning or manual recovery. It reverts to off when the device reboots.`,
        confirmLabel: 'Disable safety',
        variant: 'error',
      });
      if (!ok) return;
    }
    await this.run(controller, 'safety_override', { on: turningOn }, this.manualKey(controller, 'safety_override'));
  }

  /** Re-claim a held actuator every 60s (the lease is ~90s) so it stays driven
   *  while the operator holds it; stopping the heartbeat lets it fail-safe stop. */
  private startHeartbeat(controller: string, node: string, key: string): void {
    this.stopHeartbeat(key);
    const h = window.setInterval(() => {
      void this.backend.sendCommand(this.siteId, controller, 'node_set', { nodeId: node, on: true }).catch(() => {});
    }, 60_000);
    this.heartbeats.set(key, h);
  }

  private stopHeartbeat(key: string): void {
    const h = this.heartbeats.get(key);
    if (h) { clearInterval(h); this.heartbeats.delete(key); }
  }
}
