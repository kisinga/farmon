import { Component, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { buildDashboardSpec, parseTopology, COMMAND_TTL_S, controllerHealth, worstHealth, describeState, SYSTEM_STATE_MEANINGS, STOP_REASON_MEANINGS, SYSTEM_STATE_SENSOR, STOP_REASON_SENSOR, HEAP_FREE_SENSOR, HEAP_MIN_SENSOR, HEAP_WARN_BYTES, type CommandAction, type CommandPhase, type DashboardWidget, type ActuatorControl, type HealthLevel, type StateKind, type StateMeaning } from '@core';
import { BackendService } from '../../core/services/backend.service';
import { AuthStore } from '../../core/services/auth.store';
import { ConfirmService } from '../../core/services/confirm.service';
import { DashboardStore } from './dashboard.store';
import { TelemetryStore } from './telemetry.store';
import { CommandLifecycleStore } from './command-lifecycle.store';
import { DashboardCardComponent } from './widgets/dashboard-card.component';
import { RouteCardComponent } from './widgets/route-card.component';
import { SiteThresholdsComponent } from './widgets/site-thresholds.component';
import { TunableNumbersComponent } from './widgets/tunable-numbers.component';
import { TankCalibrationComponent } from './widgets/tank-calibration.component';
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
  imports: [DashboardCardComponent, RouteCardComponent, SiteThresholdsComponent, TunableNumbersComponent, TankCalibrationComponent, RouterLink],
  providers: [DashboardStore, TelemetryStore, CommandLifecycleStore],
  host: { class: 'flex-1 overflow-auto' },
  template: `
    <div class="max-w-6xl mx-auto w-full px-4 sm:px-6 py-5 sm:py-6">
      <!-- Compact status bar. Two pills, two questions: operational state (what the
           system is doing) and health (is the hardware well). Safety-override shows
           only while ON; the health pill expands to the full per-controller panel. -->
      <div class="flex items-center gap-2 sm:gap-3 mb-5 sm:mb-6">
        <h1 class="text-lg sm:text-xl font-bold tracking-tight leading-tight truncate min-w-0">{{ siteName() || 'Dashboard' }}</h1>
        @if (showController()) {
          <span class="text-xs text-base-content/50 shrink-0 whitespace-nowrap">{{ onlineCount() }}/{{ totalControllers() }} online</span>
        }
        <span class="grow"></span>
        @if (anyOverride()) {
          <span class="inline-flex items-center gap-1 text-xs rounded-full px-2.5 py-1 ring-1 ring-inset text-error bg-error/10 ring-error/20 shrink-0"
                title="Safety checks bypassed on a controller">
            <svg xmlns="http://www.w3.org/2000/svg" class="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5">
              <path stroke-linecap="round" stroke-linejoin="round" d="M12 9v4m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/>
            </svg>
            Override ON
          </span>
        }
        <!-- Operational state (what it's doing): aggregate, hidden when nothing is online. -->
        @if (systemChip(); as sys) {
          <span class="inline-flex items-center gap-1.5 text-xs rounded-full px-2.5 py-1 ring-1 ring-inset shrink-0"
                [class]="sys.chip" [title]="'System: ' + sys.label">
            <span class="w-1.5 h-1.5 rounded-full" [class]="sys.dot"></span>
            {{ sys.label }}
          </span>
        }
        <!-- Health (is the box well): online + heap; click for the per-controller panel. -->
        <details class="dropdown dropdown-end shrink-0">
          <summary class="list-none inline-flex items-center gap-1.5 text-xs rounded-full px-2.5 py-1 cursor-pointer ring-1 ring-inset"
                   [class]="healthUi().chip" [title]="'Device health: ' + healthUi().label">
            <span class="w-1.5 h-1.5 rounded-full" [class]="healthUi().dot" [class.animate-pulse]="siteHealth() === 'healthy'"></span>
            {{ healthUi().label }}
          </summary>
          <div class="dropdown-content z-10 mt-1 w-72 rounded-box bg-base-100 ring-1 ring-base-300/40 shadow-lg p-2">
            <div class="text-[11px] font-semibold uppercase tracking-wider text-base-content/40 px-1 pb-1">Controllers</div>
            @for (c of store.spec().controllers; track c.controller) {
              <div class="px-1 py-1.5 border-b border-base-300/20 last:border-0">
                <div class="flex items-center gap-2 text-xs">
                  <span class="w-1.5 h-1.5 rounded-full shrink-0" [class]="healthDot(c.controller)"></span>
                  <span class="font-medium truncate flex-1">{{ ctrlName(c.controller) }}</span>
                  <span class="font-mono text-base-content/60 shrink-0">{{ heapText(c.controller) }}</span>
                </div>
                <div class="flex flex-wrap items-center gap-x-3 gap-y-0.5 mt-1 pl-3.5 text-[11px] text-base-content/50">
                  <span>{{ systemLabel(c.controller) }}</span>
                  <span>Queue {{ queueText(c.controller) }}</span>
                  <span>Last stop: {{ lastStopText(c.controller) }}</span>
                  @if (overrideOn(c.controller)) { <span class="text-error font-medium">Override ON</span> }
                </div>
              </div>
            }
            <p class="text-[11px] text-base-content/40 px-1 pt-1.5 leading-snug">Free RAM. Under {{ heapWarnKb() }} KB shows a warning.</p>
          </div>
        </details>
        <button class="btn btn-sm btn-ghost gap-1.5 shrink-0" (click)="openDocs()" [disabled]="docBusy()"
                title="Open this site's documentation">
          @if (docBusy()) { <span class="loading loading-spinner loading-xs"></span> }
          @else {
            <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
              <path stroke-linecap="round" stroke-linejoin="round" d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
            </svg>
          }
          <span class="hidden sm:inline">Docs</span>
        </button>
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
                      <button class="btn btn-xs btn-error btn-outline gap-1" [disabled]="sysBusy(c.controller,'stop_all')"
                        (click)="sysCmd(c.controller,'stop_all')">
                        @if (sysBusy(c.controller,'stop_all')) { <span class="loading loading-spinner loading-xs"></span> }
                        Stop all
                      </button>
                      <details class="dropdown dropdown-end">
                        <summary class="btn btn-xs btn-ghost" title="More controller actions">⋯</summary>
                        <ul class="dropdown-content menu menu-sm z-10 mt-1 w-40 rounded-box bg-base-100 ring-1 ring-base-300/40 shadow-lg p-1">
                          <li><button [disabled]="sysBusy(c.controller,'reset_faults')" (click)="sysCmd(c.controller,'reset_faults')">Reset faults</button></li>
                          <li><button [disabled]="sysBusy(c.controller,'clear_queue')" (click)="sysCmd(c.controller,'clear_queue')">Clear queue</button></li>
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
                        [phase]="routePhase(c.controller, r.routeId)?.phase ?? null"
                        [phaseReason]="routePhase(c.controller, r.routeId)?.reason ?? ''"
                        [controllable]="canControl()"
                        (action)="routeCmd(c.controller, $event, r)"
                      />
                    }
                  </div>
                </div>
              }
            }
            <!-- Per-route timers (max runtime + level start/stop), gated by a
                 collapsed disclosure and by control. Belong to the routes above. -->
            @if (hasRouteTuning()) {
              <details class="mt-2 bg-base-100/40 rounded-2xl ring-1 ring-base-300/30 px-4 py-3">
                <summary class="cursor-pointer list-none flex items-center gap-2 text-xs font-semibold text-base-content/60">
                  Route timers
                  <span class="text-[11px] font-normal text-base-content/40">max runtime + level start/stop, per route</span>
                </summary>
                <div class="mt-3 pt-3 border-t border-base-300/30">
                  <app-tunable-numbers [controllers]="store.spec().controllers" [canEdit]="canControl()" scope="route" />
                </div>
              </details>
            }
          </section>
        }

        <!-- Automations — created and managed on the dedicated page (runtime data,
             no rebuild): schedule routes by time or tank level, optionally to a
             target volume or duration. -->
        <section class="mb-6">
          <div class="flex items-center justify-between mb-2.5">
            <h2 class="text-xs font-semibold uppercase tracking-wider text-base-content/40">Automations</h2>
            <a [routerLink]="['/site', siteId, 'automations']" class="btn btn-xs btn-ghost">Manage →</a>
          </div>
          <p class="text-xs text-base-content/50">Run routes on a schedule (time or tank level), stopping at a target volume or duration.</p>
        </section>

        <!-- Alerts: per-site thresholds (server-stored; feed the bell + email sweep).
             Owner/admin — a server write, not a device command, so the lowest gate. -->
        @if (siteId) {
          <section class="mb-6">
            <app-site-thresholds [siteId]="siteId" [canEdit]="canControl()" />
          </section>
        }

        <!-- Operator mode: install-time + safety-critical controls (pressure
             calibration, safety override, manual valve/pump holds). Collapsed by
             default; opening the disclosure IS entering operator mode (enables
             holds); destructive writes still hard-confirm. -->
        @if (canControl() && hasOperatorControls()) {
          <details class="mb-6 bg-base-100/40 rounded-2xl ring-1 ring-base-300/30 px-4 py-3">
            <summary class="cursor-pointer list-none flex items-center gap-2 text-xs font-semibold text-base-content/60">
              <svg xmlns="http://www.w3.org/2000/svg" class="h-3.5 w-3.5 shrink-0 text-base-content/40" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                <path stroke-linecap="round" stroke-linejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"/>
                <path stroke-linecap="round" stroke-linejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"/>
              </svg>
              Operator mode
              <span class="text-[11px] font-normal text-base-content/40">advanced — calibration, safety timings, override</span>
            </summary>
            <div class="mt-3 pt-3 border-t border-base-300/30 flex flex-col gap-3">
              <div class="alert alert-warning text-xs py-2">
                <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M12 9v4m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/>
                </svg>
                <span>Calibration and safety settings change device behaviour — set them only when commissioning.</span>
              </div>
              <!-- Controller-wide safety timings (flow watchdog/confirm/threshold, claim lease). -->
              <div class="bg-base-100/60 rounded-2xl ring-1 ring-base-300/30 px-4 py-3.5">
                <div class="text-[11px] font-semibold uppercase tracking-wide text-base-content/40 mb-2">Safety timings</div>
                <app-tunable-numbers [controllers]="store.spec().controllers" scope="controller" [canEdit]="canControl()" />
              </div>
              @for (c of store.spec().controllers; track c.controller) {
                @if (c.calibrations.length || c.actuators.length) {
                  <div class="bg-base-100/60 rounded-2xl ring-1 ring-base-300/30 px-4 py-3.5 flex flex-col gap-3">
                    @if (showController()) { <div class="text-xs font-semibold text-base-content/60">{{ c.name }}</div> }
                    @for (cal of c.calibrations; track cal.nodeId) {
                      <app-tank-calibration [cal]="cal" [controller]="c.controller" [canEdit]="canControl()" />
                    }
                    @if (c.actuators.length) {
                      <div class="flex items-center gap-2 pt-1 border-t border-base-300/30">
                        <span class="text-xs text-base-content/60">Safety override</span>
                        <span class="grow"></span>
                        <button class="btn btn-xs gap-1" [class]="overrideOn(c.controller) ? 'btn-error' : 'btn-ghost'"
                          [disabled]="overrideBusy(c.controller)" (click)="toggleOverride(c.controller)">
                          @if (overrideBusy(c.controller)) { <span class="loading loading-spinner loading-xs"></span> }
                          {{ overrideOn(c.controller) ? 'ON' : 'off' }}
                        </button>
                      </div>
                      @if (overrideOn(c.controller)) {
                        <p class="text-[11px] text-warning">Safety checks are OFF: a pump can run with no route and the watchdogs are bypassed. Turn this off when you finish.</p>
                      }
                      <p class="text-[11px] text-base-content/50">Tap a valve or pump card above to hold it open or running; it releases automatically if you disconnect.</p>
                    }
                  </div>
                }
              }
            </div>
          </details>
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
                    [totalSeries]="telemetry.totalSeriesFor(w)"
                    [span]="telemetry.spanFor(w)"
                    [events]="store.eventsFor(w.controller)"
                    [actuatable]="isActuatable(w)"
                    [held]="actuatorHeld(w)"
                    [phase]="actuatorPhase(w)?.phase ?? null"
                    [phaseReason]="actuatorPhase(w)?.reason ?? ''"
                    [actuatorKind]="actuatorFor(w)?.kind ?? ''"
                    [historyLoaded]="telemetry.loadedFor(w)"
                    (toggle)="toggleWidgetActuator(w)"
                    (spanChange)="onSpanChange(w, $event)"
                    (expand)="onExpand(w)"
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
export class DashboardComponent {
  private route = inject(ActivatedRoute);
  private backend = inject(BackendService);
  private auth = inject(AuthStore);
  private confirm = inject(ConfirmService);
  protected store = inject(DashboardStore);
  protected telemetry = inject(TelemetryStore);
  protected lifecycle = inject(CommandLifecycleStore);

  protected siteId = '';
  protected siteName = signal('');
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

  // --- Device presence + health (the compact status bar) -------------------
  protected onlineCount = computed(() =>
    this.store.spec().controllers.filter((c) => this.store.presence(c.controller).online).length,
  );
  protected totalControllers = computed(() => this.store.spec().controllers.length);

  /** daisyUI tone tokens per health level (UI mapping kept out of @core). */
  private static readonly HEALTH_UI: Record<HealthLevel, { dot: string; label: string; chip: string }> = {
    healthy:  { dot: 'bg-success',         label: 'Healthy',  chip: 'text-success bg-success/10 ring-success/20' },
    warning:  { dot: 'bg-warning',         label: 'Degraded', chip: 'text-warning bg-warning/10 ring-warning/20' },
    critical: { dot: 'bg-error',           label: 'Critical', chip: 'text-error bg-error/10 ring-error/20' },
    offline:  { dot: 'bg-base-content/40', label: 'Offline',  chip: 'text-base-content/50 bg-base-content/10 ring-base-content/15' },
  };

  /** Last-known free / min-free heap (bytes), null if the controller never reported it. */
  private heapFree(controller: string): number | null { return this.store.row(controller, HEAP_FREE_SENSOR)?.reported ?? null; }
  private heapMin(controller: string): number | null { return this.store.row(controller, HEAP_MIN_SENSOR)?.reported ?? null; }

  /** One controller's health (offline / critical / warning / healthy). */
  private health(controller: string): HealthLevel {
    return controllerHealth({ online: this.store.presence(controller).online, heapFree: this.heapFree(controller) });
  }
  /** Site health = worst among ONLINE controllers; offline only when none are up,
   *  and at least a warning when some are dark (so a 1/2-online site never reads
   *  a flat "Offline" next to its "1/2 online" count). */
  protected siteHealth = computed<HealthLevel>(() => {
    const ctrls = this.store.spec().controllers;
    const online = ctrls.filter((c) => this.store.presence(c.controller).online);
    if (online.length === 0) return 'offline';
    const level = worstHealth(online.map((c) => this.health(c.controller)));
    return level === 'healthy' && online.length < ctrls.length ? 'warning' : level;
  });
  protected healthUi = computed(() => DashboardComponent.HEALTH_UI[this.siteHealth()]);
  protected healthDot(controller: string): string { return DashboardComponent.HEALTH_UI[this.health(controller)].dot; }

  /** Free heap as "94 KB · min 90" for the per-controller detail; — / offline when unknown. */
  protected heapText(controller: string): string {
    const free = this.heapFree(controller);
    if (free === null) return this.store.presence(controller).online ? '—' : 'offline';
    const kb = (b: number) => `${Math.round(b / 1000)} KB`;
    const min = this.heapMin(controller);
    return min !== null ? `${kb(free)} · min ${Math.round(min / 1000)}` : kb(free);
  }
  protected heapWarnKb(): number { return Math.round(HEAP_WARN_BYTES / 1000); }

  // --- Operational state (System chip + per-controller drill-down) ---------
  private static readonly STATE_RANK: Record<StateKind, number> = { normal: 0, active: 1, warn: 2, fault: 3 };
  /** State kind → header-chip tones (consistent with the health pill styling). */
  private static readonly STATE_CHIP: Record<StateKind, { dot: string; chip: string }> = {
    active: { dot: 'bg-success',         chip: 'text-success bg-success/10 ring-success/20' },
    warn:   { dot: 'bg-warning',         chip: 'text-warning bg-warning/10 ring-warning/20' },
    fault:  { dot: 'bg-error',           chip: 'text-error bg-error/10 ring-error/20' },
    normal: { dot: 'bg-base-content/40', chip: 'text-base-content/60 bg-base-content/10 ring-base-content/15' },
  };

  private systemMeaning(controller: string): StateMeaning {
    return describeState(SYSTEM_STATE_MEANINGS, this.store.row(controller, SYSTEM_STATE_SENSOR)?.reported_text ?? 'IDLE');
  }
  /** Per-controller operational state label (drill-down). */
  protected systemLabel(controller: string): string { return this.systemMeaning(controller).label; }
  /** Queue depth as text; '—' when never reported. */
  protected queueText(controller: string): string {
    const q = this.store.row(controller, 'queue_depth')?.reported;
    return q == null ? '—' : String(Math.round(q));
  }
  /** Last stop reason label; 'None' when never reported. */
  protected lastStopText(controller: string): string {
    const t = this.store.row(controller, STOP_REASON_SENSOR)?.reported_text;
    return t ? describeState(STOP_REASON_MEANINGS, t).label : 'None';
  }
  /** Any controller running with safety checks bypassed (a danger flag). */
  protected anyOverride = computed(() =>
    this.store.spec().controllers.some((c) => this.overrideOn(c.controller)),
  );
  /** Aggregate operational state for the header chip: the most significant state
   *  across ONLINE controllers (an offline controller's last state is stale).
   *  Null when nothing is online (the health pill already says "Offline"). */
  protected systemChip = computed<{ label: string; dot: string; chip: string } | null>(() => {
    const online = this.store.spec().controllers.filter((c) => this.store.presence(c.controller).online);
    if (online.length === 0) return null;
    let best: StateMeaning | null = null;
    for (const c of online) {
      const m = this.systemMeaning(c.controller);
      if (!best || DashboardComponent.STATE_RANK[m.kind] > DashboardComponent.STATE_RANK[best.kind]) best = m;
    }
    return best ? { label: best.label, ...DashboardComponent.STATE_CHIP[best.kind] } : null;
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
      case 'tank':     return 'levels';
      case 'flow':     return 'flow';
      case 'line':     return 'pressure'; // remaining line charts are pressure/filter (psi)
      case 'stat':     return w.unit === 'L' ? 'flow' : 'status'; // stray flow totals vs queue depth
      default:         return 'status'; // badges: system state, last stop, override
    }
  }

  /** Widgets grouped into ordered, labelled sections (empty sections dropped). */
  protected sections = computed(() => {
    // 'status' (system / last stop / queue / safety override) is relocated to the
    // header bar + its per-controller panel, so it is intentionally not a section.
    const labels: Record<string, string> = {
      levels: 'Tank levels', valves: 'Valves',
      flow: 'Flow', pressure: 'Pressure', activity: 'Activity',
    };
    const order = ['levels', 'valves', 'flow', 'pressure', 'activity'] as const;
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

  // --- Operator-mode tiers -------------------------------------------------
  /** Any per-route timer exists (drives the "Route timers" disclosure in Routes). */
  protected hasRouteTuning = computed(() => this.store.spec().controllers.some((c) => c.tunables.some((t) => t.scope === 'route')));
  /** Any operator-mode control exists: controller safety timings, pressure
   *  calibration, or a manual actuator. */
  protected hasOperatorControls = computed(() => this.store.spec().controllers.some((c) =>
    c.tunables.some((t) => t.scope === 'controller') || c.calibrations.length > 0 || c.actuators.length > 0));

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

  private routeKey(controller: string, routeId: number): string {
    return `${controller}/route/${routeId}`;
  }

  /** The route's live command phase (pending/refused/…) for the card overlay, or
   *  null when no command is in flight (the card's state view drives). */
  protected routePhase(controller: string, routeId: number): { phase: CommandPhase; reason: string } | null {
    return this.lifecycle.phaseFor(this.routeKey(controller, routeId));
  }

  // --- Widget section layout -----------------------------------------------
  /** Valves render as a dense glyph grid; everything else as full cards. */
  protected denseSection(id: string): boolean { return id === 'valves'; }
  protected gridFor(id: string): string {
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
  /** Toggleable now: an actuator exists, control is held, and the device is online.
   *  (Manual holds are a normal control under "take control" — NOT gated by operator
   *  mode; only calibration + safety override live behind that.) */
  protected isActuatable(w: DashboardWidget): boolean {
    return this.canControl() && !!this.actuatorFor(w) && this.store.presence(w.controller).online;
  }
  private nodeKey(controller: string, nodeId: string): string {
    return `${controller}/node/${nodeId}`;
  }
  protected actuatorHeld(w: DashboardWidget): boolean {
    const a = this.actuatorFor(w);
    return a ? this.lifecycle.isHeld(this.nodeKey(w.controller, a.id)) : false;
  }
  /** The actuator's live command phase for the card overlay, null when idle. */
  protected actuatorPhase(w: DashboardWidget): { phase: CommandPhase; reason: string } | null {
    const a = this.actuatorFor(w);
    return a ? this.lifecycle.phaseFor(this.nodeKey(w.controller, a.id)) : null;
  }
  protected toggleWidgetActuator(w: DashboardWidget): void {
    const a = this.actuatorFor(w);
    if (a && this.canControl()) void this.lifecycle.toggleClaim(this.nodeKey(w.controller, a.id), w.controller, a);
  }

  constructor() {
    this.siteId = this.route.snapshot.paramMap.get('name') ?? '';
    if (this.siteId) void this.load();
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
    // Backfill history for the charted widgets (line + flow rate). Each uses its
    // own remembered span (telemetry.load defaults to the widget's stored span).
    for (const w of spec.widgets) {
      if (w.kind === 'line' || w.kind === 'flow') void this.telemetry.load(this.siteId, w);
    }
  }

  /** Operator picked a new timescale for a chart — reload it at that span. */
  protected onSpanChange(w: DashboardWidget, hours: number): void {
    if (this.siteId) void this.telemetry.setSpan(this.siteId, w, hours);
  }

  /** Tank history panel opened for the first time — backfill its series (lazy, so
   *  we don't fetch history for every tank up front the way flow/line do). */
  protected onExpand(w: DashboardWidget): void {
    if (this.siteId) void this.telemetry.load(this.siteId, w);
  }

  /** Safety override reported state, read from the shadow (the device switch). */
  protected overrideOn(controller: string): boolean {
    const r = this.store.row(controller, 'safety_override');
    return !!r && r.reported >= 0.5;
  }

  // --- Command dispatch — every control routes through the lifecycle store, which
  //     tracks the command by command_id and exposes the phase the cards render. --

  private sysKey(controller: string, action: CommandAction): string {
    return `${controller}/sys/${action}`;
  }
  private overrideKey(controller: string): string {
    return `${controller}/override`;
  }
  protected sysBusy(controller: string, action: CommandAction): boolean {
    return this.lifecycle.isBusy(this.sysKey(controller, action));
  }
  protected overrideBusy(controller: string): boolean {
    return this.lifecycle.isBusy(this.overrideKey(controller));
  }

  /** Warn (only) when the target reads offline — the per-control phase is the
   *  primary feedback; this keeps the "expires in ~Nm" copy for a dark device. */
  private offlineNote(controller: string): void {
    this.note.set(
      this.store.presence(controller).online
        ? null
        : `${this.ctrlName(controller)} looks offline — the command expires in ~${this.ttlMin} min if it doesn't reconnect.`,
    );
  }

  /** Start/stop/fault-reset a route (the route-card emits one of these). */
  protected async routeCmd(controller: string, action: CommandAction, route: RouteControl): Promise<void> {
    if (!this.canControl()) return;
    await this.lifecycle.dispatch(this.routeKey(controller, route.routeId), controller, action, { route });
    this.offlineNote(controller);
  }

  /** Fan-out / system command (stop_all, reset_faults, clear_queue). */
  protected async sysCmd(controller: string, action: CommandAction): Promise<void> {
    if (!this.canControl()) return;
    await this.lifecycle.dispatch(this.sysKey(controller, action), controller, action);
    this.offlineNote(controller);
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
    await this.lifecycle.dispatch(this.overrideKey(controller), controller, 'safety_override', { on: turningOn });
    this.offlineNote(controller);
  }
}
