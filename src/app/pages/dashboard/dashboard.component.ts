import { Component, computed, inject, signal } from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { ActivatedRoute } from '@angular/router';
import { buildDashboardSpec, createEmptySiteTopology, parseTopology, COMMAND_TTL_S, type CommandAction, type CommandPhase, type DashboardWidget, type ActuatorControl, type RuntimeState } from '@core';
import { BackendService } from '../../core/services/backend.service';
import { AuthStore } from '../../core/services/auth.store';
import { DashboardStore } from './dashboard.store';
import { TelemetryStore } from './telemetry.store';
import { CommandLifecycleStore } from './command-lifecycle.store';
import { runProgress, type RunProgress } from './run-progress';
import { DashboardCardComponent } from './widgets/dashboard-card.component';
import { RouteCardComponent } from './widgets/route-card.component';
import { UsageTotalsComponent } from './widgets/usage-totals.component';
import { SiteControlsComponent } from './widgets/site-controls.component';
import { ControllerHealthComponent } from './widgets/controller-health.component';
import { HealthHistoryComponent } from './widgets/health-history.component';
import { LiveMapComponent } from './canvas/live-map.component';
import { CONTROLLER_PALETTE } from '../../core/util/site-colors';
import { DEVICE_MODE } from '../../core/tokens/device-mode';
import type { SiteTopology } from '../../core/models/topology.model';
import type { RouteControl, StopSpecOverride } from '@core';

/** A widget section as `sections()` produces it. */
interface DashSection { id: string; label: string; widgets: DashboardWidget[] }

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
  imports: [NgTemplateOutlet, DashboardCardComponent, RouteCardComponent, UsageTotalsComponent, SiteControlsComponent, ControllerHealthComponent, HealthHistoryComponent, LiveMapComponent],
  providers: [DashboardStore, TelemetryStore, CommandLifecycleStore],
  host: { class: 'flex-1 overflow-auto' },
  styles: [`
    /* Flow-grid reveal: compositor-only (opacity + transform) so it costs nothing to
       paint, replays whenever @if re-inserts the grid. No JS, no layout thrash. */
    @keyframes dash-reveal { from { opacity: 0; transform: translateY(-6px) } to { opacity: 1; transform: translateY(0) } }
    .dash-reveal { animation: dash-reveal 420ms cubic-bezier(0.16, 1, 0.3, 1) }
    @media (prefers-reduced-motion: reduce) { .dash-reveal { animation: none } }
  `],
  template: `
    <div class="max-w-6xl mx-auto w-full px-4 sm:px-6 py-5 sm:py-6">
      <!-- Top bar: site name + online count on the left; on the right the health
           pill (expands to the full per-controller panel) and the quiet utility
           actions - Automations, Setup (operator-gated), and Docs. -->
      <div class="flex flex-wrap items-center gap-x-3 gap-y-1.5 mb-5 sm:mb-6">
        <div class="flex items-baseline gap-2 min-w-0 flex-1">
          <h1 class="app-title text-lg sm:text-xl font-bold leading-tight truncate min-w-0">{{ siteName() || 'Dashboard' }}</h1>
          @if (showController()) {
            <span class="text-xs text-base-content/50 shrink-0 whitespace-nowrap">{{ onlineCount() }}/{{ totalControllers() }} online</span>
          }
        </div>
        <div class="flex items-center gap-2 shrink-0">
        @if (adminViewing()) {
          <span class="badge badge-sm gap-1 shrink-0" [class]="controlEnabled() ? 'badge-warning' : 'badge-info'">{{ controlEnabled() ? 'Controlling' : 'Read-only' }}</span>
        }
        <app-controller-health />
        <!-- Automations + Setup: quiet icon actions slotted in beside Docs (they
             render with display:contents, so they sit directly in this flex row).
             Automations works in device mode too (the device serves its own
             /local/automations); the Setup section and Docs are cloud-backed
             (PocketBase collections / doc builder) — hidden in the device build. -->
        @if (siteId) {
          <app-site-controls [siteId]="siteId" [canControl]="canControl()" />
        }
        @if (!deviceMode) {
          <button class="btn btn-sm btn-ghost gap-1.5 shrink-0" (click)="openDocs()" [disabled]="docBusy()"
                  title="Open this site's documentation" aria-label="Open documentation">
            @if (docBusy()) { <span class="loading loading-spinner loading-xs"></span> }
            @else {
              <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                <path stroke-linecap="round" stroke-linejoin="round" d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
              </svg>
            }
            <span class="hidden sm:inline">Docs</span>
          </button>
        }
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

        <!-- Routes - the live control surface. Shown to everyone (status reads
             even in admin read-only); the toggle is disabled, not hidden, when
             control isn't held. Each card animates water when its route flows
             and toggles start/stop on click. -->
        @if (hasRoutes()) {
          <!-- One controller's actions (Stop all + the more menu), shared by the
               Routes header (single-controller sites) and each controller's own
               row (multi-controller) so the two placements can't drift. -->
          <ng-template #ctrlActions let-cid="cid">
            <button class="btn btn-xs btn-error btn-outline gap-1" [disabled]="sysBusy(cid,'stop_all')" (click)="sysCmd(cid,'stop_all')">
              @if (sysBusy(cid,'stop_all')) { <span class="loading loading-spinner loading-xs"></span> }
              Stop all
            </button>
            <details class="dropdown dropdown-end">
              <summary class="btn btn-xs btn-ghost" title="More controller actions">⋯</summary>
              <ul class="dropdown-content menu menu-sm z-10 mt-1 w-40 rounded-box bg-base-100 ring-1 ring-base-300/40 shadow-lg p-1">
                <li><button [disabled]="sysBusy(cid,'reset_faults')" (click)="sysCmd(cid,'reset_faults')">Reset faults</button></li>
                <li><button [disabled]="sysBusy(cid,'clear_queue')" (click)="sysCmd(cid,'clear_queue')">Clear queue</button></li>
              </ul>
            </details>
          </ng-template>

          <section class="mb-6">
            <!-- Section header. A single-controller site hosts Stop all / ⋯ right
                 here - its per-controller row would otherwise be a lone presence dot
                 and the buttons stranded across an empty strip. Online state already
                 lives in the page-header pill, so no dot is repeated. Multi-controller
                 sites keep the dot + name + actions on each controller's row below. -->
            <div class="flex flex-wrap items-center gap-2 mb-3">
              <span class="w-1 h-3.5 rounded-full bg-primary/70 shrink-0"></span>
              <h2 class="section-label">Routes</h2>
              <span class="grow"></span>
              @if (monitorCount() > 0 && anyRunnable()) {
                <button type="button"
                  class="btn btn-xs btn-ghost gap-1 px-2 text-base-content/50 hover:text-base-content"
                  [attr.aria-expanded]="showMonitor()"
                  [attr.aria-label]="(showMonitor() ? 'Hide' : 'Show') + ' monitor-only routes'"
                  [title]="showMonitor() ? 'Hide monitor-only routes' : ('Show ' + monitorCount() + ' monitor-only route' + (monitorCount() === 1 ? '' : 's') + ' (no actuator to control)')"
                  (click)="toggleMonitorRoutes()">
                  @if (showMonitor()) {
                    <svg class="h-3.5 w-3.5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9.88 9.88a3 3 0 1 0 4.24 4.24"/><path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c6.5 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68"/><path d="M6.61 6.61A13.5 13.5 0 0 0 2 12s3.5 7 10 7a9.74 9.74 0 0 0 5.39-1.61"/><path d="m2 2 20 20"/></svg>
                  } @else {
                    <svg class="h-3.5 w-3.5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/></svg>
                  }
                  <span class="tabular-nums">{{ monitorCount() }}</span>
                </button>
              }
              @if (soloController(); as cid) {
                @if (canControl()) {
                  <ng-container [ngTemplateOutlet]="ctrlActions" [ngTemplateOutletContext]="{ cid }" />
                }
              }
            </div>
            @if (adminViewing() && !controlEnabled()) {
              <p class="text-[11px] text-base-content/50 -mt-2 mb-3">Viewing read-only — <button type="button" class="link link-primary font-medium" (click)="controlEnabled.set(true)">take control</button> to operate.</p>
            }
            <!-- One route card, reused by the controllable grid and the revealed
                 monitor-only grid (so their binding can't drift). -->
            <ng-template #routeCard let-r="r" let-cid="cid">
              <app-route-card
                [route]="r"
                [state]="routeState(cid, r.routeId)"
                [flowRate]="routeFlow(cid, r)"
                [progress]="routeProgress(cid, r)"
                [fillMs]="fillMs()"
                [online]="store.presence(cid).online"
                [phase]="routePhase(cid, r.routeId)?.phase ?? null"
                [phaseReason]="routePhase(cid, r.routeId)?.reason ?? ''"
                [controllable]="canControl()"
                (action)="routeCmd(cid, $event, r)"
                (run)="routeRun(cid, $event, r)"
              />
            </ng-template>
            @for (g of routeGroups(); track g.c.controller) {
              @if (g.runnable.length || (showMonitor() && g.monitor.length)) {
                <div class="mb-4 last:mb-0">
                  @if (showController()) {
                    <div class="flex items-center gap-2 mb-2">
                      <span class="w-2 h-2 rounded-full shrink-0" [class]="store.presence(g.c.controller).online ? 'bg-success' : 'bg-base-content/30'"
                        [title]="store.presence(g.c.controller).online ? 'Online' : ('Offline · ' + lastSeenText(g.c.controller))"></span>
                      <span class="text-xs font-semibold text-base-content/60">{{ g.c.name }}</span>
                      <span class="grow"></span>
                      @if (canControl()) {
                        <ng-container [ngTemplateOutlet]="ctrlActions" [ngTemplateOutletContext]="{ cid: g.c.controller }" />
                      }
                    </div>
                  }
                  @if (g.runnable.length) {
                    <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                      @for (r of g.runnable; track r.routeId) {
                        <ng-container [ngTemplateOutlet]="routeCard" [ngTemplateOutletContext]="{ r, cid: g.c.controller }" />
                      }
                    </div>
                  }
                  @if (showMonitor() && g.monitor.length) {
                    <div class="flex items-center gap-2 mt-3 mb-2">
                      <span class="text-[11px] font-medium uppercase tracking-wide text-base-content/40 shrink-0">Monitor only</span>
                      <span class="grow border-t border-base-300/30"></span>
                    </div>
                    <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                      @for (r of g.monitor; track r.routeId) {
                        <ng-container [ngTemplateOutlet]="routeCard" [ngTemplateOutletContext]="{ r, cid: g.c.controller }" />
                      }
                    </div>
                  }
                </div>
              }
            }
          </section>
        }

        <!-- System view — directly below the route controls, where the swap it
             controls actually happens. The Map/Cards toggle sits in this header
             so it's obvious it governs what's right below (the live map, or the
             valve/tank cards it stands in for). Map draws the whole topology and
             lights the running route's path. -->
        @if (topology()) {
          <section class="mb-6">
            <div class="flex items-center gap-2 mb-3">
              <!-- Map mode is self-titled here; cards mode keeps each sub-section's
                   own label (Tank levels / Valves) below, so no title here. -->
              @if (useCanvas()) {
                <h2 class="section-label">System map</h2>
              }
              <span class="grow"></span>
              <div class="join shrink-0" role="group" aria-label="System view">
                <button type="button" class="join-item btn btn-sm gap-1.5" [class.btn-active]="useCanvas()"
                        [attr.aria-pressed]="useCanvas()" (click)="useCanvas.set(true)" title="Live system map">
                  <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                    <path stroke-linecap="round" stroke-linejoin="round" d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7" />
                  </svg>
                  <span>Map</span>
                </button>
                <button type="button" class="join-item btn btn-sm gap-1.5" [class.btn-active]="!useCanvas()"
                        [attr.aria-pressed]="!useCanvas()" (click)="useCanvas.set(false)" title="Status cards">
                  <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                    <path stroke-linecap="round" stroke-linejoin="round" d="M4 5a1 1 0 011-1h5a1 1 0 011 1v5a1 1 0 01-1 1H5a1 1 0 01-1-1V5zM13 5a1 1 0 011-1h5a1 1 0 011 1v5a1 1 0 01-1 1h-5a1 1 0 01-1-1V5zM4 14a1 1 0 011-1h5a1 1 0 011 1v5a1 1 0 01-1 1H5a1 1 0 01-1-1v-5zM13 14a1 1 0 011-1h5a1 1 0 011 1v5a1 1 0 01-1 1h-5a1 1 0 01-1-1v-5z" />
                  </svg>
                  <span>Cards</span>
                </button>
              </div>
            </div>
            @if (useCanvas()) {
              <app-live-map [topology]="topology()" [runtime]="store.nodeRuntime()" [activePath]="store.activePath()" />
            } @else {
              @for (section of systemSections(); track section.id) {
                <div class="mb-4 last:mb-0">
                  <h2 class="section-label mb-3">{{ section.label }}</h2>
                  <div [class]="gridFor(section.id, section.widgets.length)">
                  @for (w of section.widgets; track w.id) {
                    <app-dashboard-card
                      [widget]="w"
                      [dense]="denseSection(section.id)"
                      [controllerLabel]="showController() ? ctrlName(w.controller) : ''"
                      [controllerColor]="ctrlColor(w.controller)"
                      [row]="store.rowFor(w)"
                      [state]="cardState(w)"
                      [series]="telemetry.seriesFor(w)"
                      [span]="telemetry.spanFor(w)"
                      [items]="store.activityFor(w.controller)"
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
                  }
                  </div>
                </div>
              }
            }
          </section>
        }

        @if (note()) { <div class="text-xs text-base-content/50 mb-3">{{ note() }}</div> }

        <!-- Body: the remaining card sections (flow / pressure / activity). The
             valve + tank-level sections live in the System view above (as the map,
             or as cards); only when there's no topology do they fall through here. -->
        <!-- One card section (header + responsive grid), reused by the live-trends
             layout and the Activity log in the Reporting zone below. -->
        <ng-template #cardSection let-section>
          <section class="mb-6">
            <!-- Flow trends collapse by default: the Water-usage chart below is the headline
                 graph; flow rate is on-demand detail. Section order is unchanged — this only
                 hides the Flow grid behind its header toggle (same idiom as monitor routes). -->
            @if (section.id === 'flow') {
              <button type="button"
                class="flex items-center gap-2 mb-3 w-full text-left group"
                [attr.aria-expanded]="flowExpanded()"
                [attr.aria-label]="(flowExpanded() ? 'Hide' : 'Show') + ' flow rate charts'"
                [title]="flowExpanded() ? 'Hide flow rate charts' : ('Show ' + section.widgets.length + ' flow rate chart' + (section.widgets.length === 1 ? '' : 's'))"
                (click)="toggleFlowCharts()">
                <h2 class="section-label">{{ section.label }}</h2>
                <span class="text-[11px] tabular-nums text-base-content/35">{{ section.widgets.length }}</span>
                <span class="grow"></span>
                <svg class="h-4 w-4 shrink-0 text-base-content/40 transition-transform group-hover:text-base-content/70" [class.rotate-180]="flowExpanded()" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>
              </button>
            } @else {
              <h2 class="section-label mb-3">{{ section.label }}</h2>
            }
            @if (section.id !== 'flow' || flowExpanded()) {
            <div [class]="gridFor(section.id, section.widgets.length) + (section.id === 'flow' ? ' dash-reveal' : '')">
              @for (w of section.widgets; track w.id) {
                <app-dashboard-card
                  [widget]="w"
                  [dense]="denseSection(section.id)"
                  [controllerLabel]="showController() ? ctrlName(w.controller) : ''"
                  [controllerColor]="ctrlColor(w.controller)"
                  [row]="store.rowFor(w)"
                  [state]="cardState(w)"
                  [series]="telemetry.seriesFor(w)"
                  [span]="telemetry.spanFor(w)"
                  [items]="store.activityFor(w.controller)"
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
              }
            </div>
            }
          </section>
        </ng-template>

        <!-- Live trends (flow / pressure). -->
        @for (section of layout(); track section.id) {
          <ng-container [ngTemplateOutlet]="cardSection" [ngTemplateOutletContext]="{ $implicit: section }" />
        }

        <!-- Reporting zone: usage summary above the activity detail log. Cloud-only
             (the /usage facade + the audit feeds have no device endpoint). -->
        @if (hasRoutes() && !deviceMode) {
          <section class="mb-6">
            <h2 class="section-label mb-3">Water usage</h2>
            <app-usage-totals [spec]="store.spec()" />
          </section>
        }
        @for (section of activitySections(); track section.id) {
          <ng-container [ngTemplateOutlet]="cardSection" [ngTemplateOutletContext]="{ $implicit: section }" />
        }

        <!-- Device health history — diagnostic, so it sits at the foot of the
             Reporting zone, collapsed by default (same idiom as the flow charts /
             monitor routes). WiFi / RAM / temp / uptime read the same telemetry tiers
             as the trend charts; the panel lazy-loads on first open. Cloud-only:
             the device keeps no telemetry tiers. -->
        @if (!deviceMode) {
        <section class="mb-6">
          <button type="button"
            class="flex items-center gap-2 mb-3 w-full text-left group"
            [attr.aria-expanded]="healthExpanded()"
            [attr.aria-label]="(healthExpanded() ? 'Hide' : 'Show') + ' device health history'"
            [title]="healthExpanded() ? 'Hide device health history' : 'Show WiFi, RAM, temperature and uptime over time'"
            (click)="toggleHealth()">
            <h2 class="section-label">Device health</h2>
            <span class="grow"></span>
            <svg class="h-4 w-4 shrink-0 text-base-content/40 transition-transform group-hover:text-base-content/70" [class.rotate-180]="healthExpanded()" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>
          </button>
          @if (healthExpanded()) {
            <app-health-history class="dash-reveal" [siteId]="siteId" />
          }
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
  protected store = inject(DashboardStore);
  protected telemetry = inject(TelemetryStore);
  protected lifecycle = inject(CommandLifecycleStore);

  /** Device-mode build (served from the controller's flash): the cloud-only
   *  surfaces — history charts, water usage, activity feed, health history,
   *  setup, docs — are hidden; automations (the device serves its own
   *  /local/automations), routes, tank levels, the live map and command tracking
   *  stay. */
  protected deviceMode = inject(DEVICE_MODE);

  protected siteId = '';
  protected siteName = signal('');
  protected note = signal<string | null>(null);

  /** Parsed topology, kept for the live map (the card spec is derived separately). */
  protected topology = signal<SiteTopology | null>(null);
  /** Fill glide for the route progress bar ~ the snapshot interval (held on the
   *  topology), so the bar moves continuously between updates instead of stepping. */
  protected fillMs = computed(() => {
    const secs = (this.topology() as { timing?: { update_interval?: number } } | null)?.timing?.update_interval;
    return (secs && secs > 0 ? secs : 10) * 1000;
  });
  /** Live SCADA map vs. the card grid, toggled in the System view header. Defaults
   *  to the map on tablet/desktop but to cards on mobile (the map's pan/zoom is
   *  awkward on a small touch screen); `<640px` is Tailwind's `sm` breakpoint.
   *  `typeof window` guards SSR — the server has no viewport, so it renders cards. */
  protected useCanvas = signal(typeof window !== 'undefined' && window.matchMedia('(min-width: 640px)').matches);

  /** Card sections the system map stands in for when the canvas is on. The map
   *  draws the whole topology, so it replaces both the actuator controls and the
   *  tank-level cards — those nodes (and their live level) render on the map. */
  private static readonly MAP_ABSORBS = new Set(['valves', 'levels']);

  /** The sections shown inside the System view's cards mode (valves + tank levels)
   *  — the card alternative to the live map. The map stands in for exactly these. */
  protected systemSections = computed<DashSection[]>(() =>
    this.sections().filter((section) => DashboardComponent.MAP_ABSORBS.has(section.id)));

  /** The live-trend body sections (flow, pressure). The map-absorbed sections render
   *  in the System view above; `activity` moves down into the Reporting zone with the
   *  usage totals (it's a look-back log, not a live trend). Without a topology there's
   *  no System view, so the absorbed sections fall through here (activity still does not). */
  protected layout = computed<DashSection[]>(() => {
    // Device mode renders no history charts (flow/pressure read the telemetry
    // tiers, which don't exist on the device) — echarts never loads.
    if (this.deviceMode) return [];
    const secs = this.sections().filter((s) => s.id !== 'activity');
    if (!this.topology()) return secs;
    return secs.filter((section) => !DashboardComponent.MAP_ABSORBS.has(section.id));
  });

  /** The activity log section(s), rendered at the bottom of the Reporting zone
   *  (below the usage totals: summary above detail). Cloud-only: the device keeps
   *  no transition/command/config audit log. */
  protected activitySections = computed<DashSection[]>(() =>
    this.deviceMode ? [] : this.sections().filter((s) => s.id === 'activity'));

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

  /** id → { name, colour } for every controller in the spec. */
  private ctrlMeta = computed(() => {
    const m = new Map<string, { name: string; color: string }>();
    this.store.spec().controllers.forEach((c, i) =>
      m.set(c.controller, { name: c.name, color: CONTROLLER_PALETTE[i % CONTROLLER_PALETTE.length] }),
    );
    return m;
  });

  /** Only label widgets by controller when the site actually has more than one. */
  protected showController = computed(() => this.store.spec().controllers.length > 1);
  /** The id of the only controller when a site has exactly one (else null). Lets the
   *  Routes header host that controller's Stop all / ⋯ instead of leaving a lone
   *  presence dot stranded in an otherwise-empty per-controller row. */
  protected soloController = computed(() => {
    const cs = this.store.spec().controllers;
    return cs.length === 1 ? cs[0].controller : null;
  });
  protected ctrlName(id: string): string { return this.ctrlMeta().get(id)?.name ?? id; }
  protected ctrlColor(id: string): string { return this.ctrlMeta().get(id)?.color ?? '#94a3b8'; }

  // --- Device presence (the compact status bar) ----------------------------
  protected onlineCount = computed(() =>
    this.store.spec().controllers.filter((c) => this.store.presence(c.controller).online).length,
  );
  protected totalControllers = computed(() => this.store.spec().controllers.length);

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
      flow: 'Flow rate history', pressure: 'Pressure', activity: 'Activity',
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

  /** Operator's choice to reveal monitor-only (non-controllable) routes. Collapsed by
   *  default, remembered per site; only surfaced when such routes exist. */
  protected showMonitorRoutes = signal(false);
  private monitorKey(): string { return `mf:routes:monitor:${this.siteId}`; }
  protected toggleMonitorRoutes(): void {
    const v = !this.showMonitorRoutes();
    this.showMonitorRoutes.set(v);
    try { localStorage.setItem(this.monitorKey(), v ? '1' : '0'); } catch { /* private mode */ }
  }

  /** Flow-rate trend charts collapse by default — the Water-usage chart is the headline
   *  graph, flow rate is on-demand detail. Remembered per site; section order unchanged. */
  protected flowExpanded = signal(false);
  private flowKey(): string { return `mf:trends:flow:${this.siteId}`; }
  protected toggleFlowCharts(): void {
    const v = !this.flowExpanded();
    this.flowExpanded.set(v);
    try { localStorage.setItem(this.flowKey(), v ? '1' : '0'); } catch { /* private mode */ }
  }

  /** Device-health history collapses by default — it's diagnostic, not the headline.
   *  Remembered per site; lazy-loads its series only once opened. */
  protected healthExpanded = signal(false);
  private healthKey(): string { return `mf:health:history:${this.siteId}`; }
  protected toggleHealth(): void {
    const v = !this.healthExpanded();
    this.healthExpanded.set(v);
    try { localStorage.setItem(this.healthKey(), v ? '1' : '0'); } catch { /* private mode */ }
  }
  /** Monitor-only = no actuator to control (a flow meter and/or level, but no valve or
   *  pump). Missing caps (non-spec literals) default to controllable, so nothing hides
   *  by accident. */
  private isMonitorOnly(r: RouteControl): boolean { return r.caps !== undefined && !r.caps.runnable; }
  /** Each controller's routes split into controllable + monitor-only, once per spec
   *  change (the template reads these instead of re-filtering every change detection). */
  protected routeGroups = computed(() =>
    this.store.spec().controllers.map((c) => ({
      c,
      runnable: c.routes.filter((r) => !this.isMonitorOnly(r)),
      monitor: c.routes.filter((r) => this.isMonitorOnly(r)),
    })));
  /** Total monitor-only routes across controllers — drives the header toggle + its badge. */
  protected monitorCount = computed(() => this.routeGroups().reduce((n, g) => n + g.monitor.length, 0));
  /** Whether any controllable route exists. If none, monitor-only routes show
   *  unconditionally (hiding them all would leave an empty Routes section). */
  protected anyRunnable = computed(() => this.routeGroups().some((g) => g.runnable.length > 0));
  /** Effective reveal state: the operator's toggle, or forced on when there's nothing else. */
  protected showMonitor = computed(() => this.showMonitorRoutes() || !this.anyRunnable());

  /** A route's live state for its card (token + reason + origin; empty when never seen). */
  protected routeState(controller: string, routeId: number): { token: string; reason: string; origin?: string; initiator?: { label: string; support: boolean; title: string } } {
    const s = this.store.routeState(controller, routeId);
    return { token: s?.token ?? '', reason: s?.reason ?? '', origin: s?.origin, initiator: s?.initiator };
  }

  /** Live flow rate (L/min) for a route's primary flow sensor, null when none/unknown. */
  protected routeFlow(controller: string, r: RouteControl): number | null {
    if (!r.flowSensor) return null;
    return this.store.row(controller, r.flowSensor)?.reported ?? null;
  }

  /** Dest level captured when a level-targeted run is first seen, so the level bar is
   *  run-relative (0% at start) rather than the tank's absolute fill. Cleared on stop. */
  private runStartLevel = new Map<string, number>();

  /** Live progress for the card-as-progress-bar: the route's `live` facts (delivered /
   *  elapsed / targets) against the dest tank's live level. null until the device
   *  reports live data (then the card shows the flow rate instead). */
  protected routeProgress(controller: string, r: RouteControl): RunProgress | null {
    const key = this.routeKey(controller, r.routeId);
    const live = this.store.routeLive(controller, r.routeId);
    if (!live) { this.runStartLevel.delete(key); return null; }
    const destLevel = r.destLevelSensor ? this.store.row(controller, r.destLevelSensor)?.reported ?? null : null;
    if (live.tl > 0 && destLevel != null && !this.runStartLevel.has(key)) this.runStartLevel.set(key, destLevel);
    return runProgress(live, destLevel, !!r.canStopOnFull, this.runStartLevel.get(key) ?? null);
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
  protected gridFor(id: string, count = 0): string {
    if (id === 'valves') return 'grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2';
    // Activity is a single full-width log per controller — span the section like
    // every other one (label left, timestamp right) so its width matches the page.
    if (id === 'activity') return 'grid grid-cols-1 gap-3';
    // Pick the column count to the widget count so a sparse section fills its
    // row instead of leaving empty columns (1 → capped, 2 → halves, 3+ → thirds).
    if (count === 1) return 'grid grid-cols-1 gap-3 max-w-md';
    if (count === 2) return 'grid grid-cols-1 sm:grid-cols-2 gap-3';
    return 'grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3';
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
  /** Canonical node state for an actuator card, from the shared projection — so
   *  the card and the live map agree on on/off. Null for non-node widgets. */
  protected cardState(w: DashboardWidget): RuntimeState | null {
    const a = this.actuatorFor(w);
    return a ? this.store.nodeRuntime().get(a.id)?.state ?? null : null;
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
    if (this.siteId) {
      try { this.showMonitorRoutes.set(localStorage.getItem(this.monitorKey()) === '1'); } catch { /* private mode */ }
      try { this.flowExpanded.set(localStorage.getItem(this.flowKey()) === '1'); } catch { /* private mode */ }
      try { this.healthExpanded.set(localStorage.getItem(this.healthKey()) === '1'); } catch { /* private mode */ }
      void this.load();
    }
  }

  private async load(): Promise<void> {
    const { site, topology } = await this.backend.siteLoad(this.siteId);
    this.siteName.set(site.friendlyName);
    // Admin/partner looking at a site they're not a co-owner of → start read-only.
    const me = this.auth.user()?.id;
    this.adminViewing.set(this.auth.isManager() && !(!!me && (site.owners?.includes(me) ?? false)));
    const topo = topology ? parseTopology(topology) : createEmptySiteTopology();
    this.topology.set(topo);
    const spec = buildDashboardSpec(topo);
    await this.store.init(this.siteId, spec, { update_interval: topo.timing.update_interval }, site.owners ?? [], site.people ?? []);
    // Backfill history for the charted widgets (line + flow rate). Each uses its
    // own remembered span (telemetry.load defaults to the widget's stored span).
    // Device mode has no history endpoint — nothing to backfill.
    if (!this.deviceMode) {
      for (const w of spec.widgets) {
        if (w.kind === 'line' || w.kind === 'flow') void this.telemetry.load(this.siteId, w);
      }
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

  // --- Command dispatch — every control routes through the lifecycle store, which
  //     tracks the command by command_id and exposes the phase the cards render. --

  private sysKey(controller: string, action: CommandAction): string {
    return `${controller}/sys/${action}`;
  }
  protected sysBusy(controller: string, action: CommandAction): boolean {
    return this.lifecycle.isBusy(this.sysKey(controller, action));
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
    // A non-runnable route (no valve, no pump) can't be started — only monitored.
    if (action === 'route_start' && route.caps && !route.caps.runnable) return;
    await this.lifecycle.dispatch(this.routeKey(controller, route.routeId), controller, action, { route });
    this.offlineNote(controller);
  }

  /** A targeted manual run: a route_start carrying the picker's StopSpec (volume /
   *  level / time). Same lifecycle as a plain start, just with the target attached. */
  protected async routeRun(controller: string, stopSpec: StopSpecOverride, route: RouteControl): Promise<void> {
    if (!this.canControl()) return;
    if (route.caps && !route.caps.runnable) return; // no actuator: not runnable
    await this.lifecycle.dispatch(this.routeKey(controller, route.routeId), controller, 'route_start', { route, stopSpec });
    this.offlineNote(controller);
  }

  /** Fan-out / system command (stop_all, reset_faults, clear_queue). */
  protected async sysCmd(controller: string, action: CommandAction): Promise<void> {
    if (!this.canControl()) return;
    await this.lifecycle.dispatch(this.sysKey(controller, action), controller, action);
    this.offlineNote(controller);
  }
}
