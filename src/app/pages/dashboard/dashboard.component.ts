import { Component, computed, inject, signal, type OnDestroy, type Signal } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { buildDashboardSpec, createEmptySiteTopology, parseTopology, routeLabel, describeState, FAULT_MEANINGS, STOP_REASON_MEANINGS, COMMAND_TTL_S, type CommandAction, type CommandPhase, type DashboardWidget, type ActuatorControl, type RuntimeState } from '@core';
import { BackendService } from '../../core/services/backend.service';
import { AuthStore } from '../../core/services/auth.store';
import { FeatureFlagsService } from '../../core/services/feature-flags.service';
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
import { BillingOutstandingComponent } from './widgets/billing-outstanding.component';
import { MeterValveComponent } from './widgets/meter-valve.component';
import { LiveMapComponent } from './canvas/live-map.component';
import { CONTROLLER_PALETTE } from '../../core/util/site-colors';
import { DEVICE_MODE } from '../../core/tokens/device-mode';
import type { SiteTopology } from '../../core/models/topology.model';
import type { RouteControl, StopSpecOverride } from '@core';
import { WidgetGridComponent } from '../../widgets/widget-grid.component';
import { filterByEntitlement, filterForBuild, type WidgetDef } from '../../widgets/registry';
import { resolveLayout, type LayoutItem } from '../../widgets/layout';
import { CapabilitiesService, type CapabilitiesState } from '../../widgets/capabilities.service';
import { DashboardLayoutService } from '../../widgets/layout.service';
import { WIDGET_DEFS } from './widget-defs';
import { buildDefaultLayout, WIDGET_ZONE } from './default-layout';
import { resolveRender, type WidgetRender } from './widgets';

/**
 * The site dashboard shell (`/site/:name/dashboard`): the runtime stores
 * and widget components laid out as a widget grid. The layout is
 * `resolveLayout(stored, buildDefaultLayout(spec))` — the stored layout (when
 * one exists) wins on order/width/visibility, the auto-derived default fills
 * the rest. Edit mode (the Customize toggle, ≥640px only) stages
 * reorder/resize/hide edits in a draft and saves them as the caller's personal
 * layout — or the shared site default for owners.
 *
 * The presentation is state-driven: an attention banner surfaces faults,
 * offline controllers and a live safety override above the grid (absent when
 * the system is calm), and the derived default orders zones Routes → Map →
 * Status & controls → Usage → System → Trends (default-layout.ts): the daily
 * reporting questions (consumption, activity) outrank live trend charts,
 * which are diagnostics — default-hidden like the old dashboard's collapsed
 * flow section. The map is desktop-only; on phone the node cards
 * (tanks/valves/pumps) stand in for it, while on desktop they're hidden —
 * the map already shows their state (the old MAP_ABSORBS rule, now a picker
 * toggle).
 *
 * One shell serves both builds. The device build (served from the controller's
 * flash) swaps the network surfaces via device.providers.ts (realtime/backend/
 * automations/layout) and drops the cloud-only widgets through the registry's
 * `cloudOnly` flag (`filterForBuild`) — history charts, usage totals and
 * health history have no backing endpoint on the device. Billing/Docs in the
 * header are cloud-backed too and hide on DEVICE_MODE.
 */
@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [RouterLink, WidgetGridComponent, DashboardCardComponent, RouteCardComponent, UsageTotalsComponent, SiteControlsComponent, ControllerHealthComponent, HealthHistoryComponent, LiveMapComponent, BillingOutstandingComponent, MeterValveComponent],
  providers: [DashboardStore, TelemetryStore, CommandLifecycleStore],
  host: { class: 'flex-1 overflow-auto' },
  template: `
    <div class="max-w-6xl mx-auto w-full px-4 sm:px-6 py-5 sm:py-6">
      <!-- Top bar: site name + online count on the left; on the right the health
           pill (expands to the full per-controller panel) and the quiet utility
           actions — Automations, Setup (operator-gated), Billing and Docs. -->
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
        @if (siteId) {
          <app-site-controls [siteId]="siteId" [canControl]="canControl()" />
        }
        <!-- Billing + Docs are cloud-backed (PocketBase collections / doc
             builder) — hidden in the device build. -->
        @if (!deviceMode) {
          @if (billingEnabled()) {
            <a class="btn btn-sm btn-ghost gap-1.5 shrink-0" [routerLink]="['/site', siteId, 'billing']"
               title="Tenant billing — meters, invoices, payments" aria-label="Billing">
              <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                <path stroke-linecap="round" stroke-linejoin="round" d="M17 9V7a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2m2 4h10a2 2 0 002-2v-6a2 2 0 00-2-2H9a2 2 0 00-2 2v6a2 2 0 002 2zm7-5a2 2 0 11-4 0 2 2 0 014 0z" />
              </svg>
              <span class="hidden sm:inline">Billing</span>
            </a>
          }
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
        <!-- Customize: enters layout edit mode. Per-user layouts are self-service,
             so any signed-in viewer gets it; hidden below sm — phone is read-only. -->
        @if (!editing()) {
          <button class="btn btn-sm btn-ghost gap-1.5 shrink-0 hidden sm:inline-flex" (click)="startCustomize()"
                  title="Reorder, resize and hide widgets" aria-label="Customize dashboard layout">
            <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
              <path stroke-linecap="round" stroke-linejoin="round" d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4" />
            </svg>
            <span class="hidden md:inline">Customize</span>
          </button>
        }
        </div>
      </div>

      @if (saveMsg()) { <div class="text-xs text-success mb-3">{{ saveMsg() }}</div> }

      @if (store.loading()) {
        <div class="flex items-center justify-center py-24"><span class="loading loading-spinner loading-lg"></span></div>
      } @else if (store.error()) {
        <div class="alert alert-error text-sm">{{ store.error() }}</div>
      } @else if (loadError()) {
        <div class="alert alert-error text-sm">{{ loadError() }}</div>
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

        <!-- Attention: the state-driven "needs your eyes NOW" signals — faults,
             offline controllers, a live safety override. Absent when calm. -->
        @for (a of attention(); track a.text) {
          <div class="alert mb-3 text-sm py-2" role="alert"
               [class]="a.tone === 'error' ? 'alert-error' : a.tone === 'warning' ? 'alert-warning' : 'alert-info'">
            <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
              <path stroke-linecap="round" stroke-linejoin="round" d="M12 9v4m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/>
            </svg>
            <span class="flex-1">{{ a.text }}</span>
          </div>
        }

        @if (note()) { <div class="text-xs text-base-content/50 mb-3">{{ note() }}</div> }

        <!-- Edit mode: toolbar (save / site default / reset / cancel) above the
             widget picker, which lists every layout item by name — hidden ones
             included — and toggles visibility. The grid itself does drag-reorder,
             width cycling and hiding. Edits stage in the draft signal until Save. -->
        @if (editing()) {
          <div class="mb-4 rounded-box ring-1 ring-base-300/40 bg-base-200/30 p-3">
            <div class="flex flex-wrap items-center gap-2 mb-3">
              <h2 class="section-label">Customize dashboard</h2>
              <span class="grow"></span>
              <button class="btn btn-xs btn-primary" [disabled]="saveBusy()" (click)="saveLayout('user')">
                @if (saveBusy()) { <span class="loading loading-spinner loading-xs"></span> }
                Save
              </button>
              @if (isSiteOwner() && !deviceMode) {
                <button class="btn btn-xs btn-outline" [disabled]="saveBusy()" (click)="saveLayout('site')"
                        title="Make this layout the default for everyone on this site">Set as site default</button>
              }
              <button class="btn btn-xs btn-ghost" [disabled]="saveBusy()" (click)="resetLayout()"
                      title="Forget all saved layouts and use the automatic one">Reset to default</button>
              <button class="btn btn-xs btn-ghost" [disabled]="saveBusy()" (click)="cancelEdit()">Cancel</button>
            </div>
            @if (saveError()) { <div class="alert alert-error text-sm mb-3">{{ saveError() }}</div> }
            <p class="text-xs text-base-content/50 mb-2">Drag widgets to reorder them; use the width and hide buttons on each widget. Select a greyed-out widget below to bring it back.</p>
            <div class="flex flex-wrap gap-1.5">
              @for (item of gridItems(); track item.instanceId) {
                <button type="button" class="btn btn-xs" [class.btn-outline]="!item.hidden" [class.opacity-40]="item.hidden"
                        [attr.aria-pressed]="!item.hidden"
                        [title]="(item.hidden ? 'Show' : 'Hide') + ' ' + labelFor(item)"
                        (click)="toggleHidden(item)">
                  {{ labelFor(item) }}
                </button>
              }
            </div>
          </div>
        }

        <!-- The widget grid: items render in layout order at their layout width;
             hidden items are skipped (edit mode manages them via the picker
             above). The parent template below owns what each instance renders. -->
        <app-widget-grid [items]="gridItems()" [itemTemplate]="cell" [editing]="editing()" (itemsChange)="onItemsChange($event)" />
        <ng-template #cell let-item>
          @if (renderFor(item); as r) {
            @switch (r.kind) {
              @case ('map') {
                <app-live-map [topology]="topology()" [runtime]="store.nodeRuntime()" [activePath]="store.activePath()" />
              }
              @case ('route') {
                <app-route-card
                  [route]="r.route"
                  [state]="routeState(r.controller.controller, r.route.routeId)"
                  [flowRate]="routeFlow(r.controller.controller, r.route)"
                  [progress]="routeProgress(r.controller.controller, r.route)"
                  [fillMs]="fillMs()"
                  [online]="store.presence(r.controller.controller).online"
                  [phase]="routePhase(r.controller.controller, r.route.routeId)?.phase ?? null"
                  [phaseReason]="routePhase(r.controller.controller, r.route.routeId)?.reason ?? ''"
                  [controllable]="canControl()"
                  (action)="routeCmd(r.controller.controller, $event, r.route)"
                  (run)="routeRun(r.controller.controller, $event, r.route)"
                />
              }
              @case ('telemetry') {
                <app-dashboard-card
                  [widget]="r.widget"
                  [dense]="denseWidget(r.widget)"
                  [controllerLabel]="showController() ? ctrlName(r.widget.controller) : ''"
                  [controllerColor]="ctrlColor(r.widget.controller)"
                  [row]="store.rowFor(r.widget)"
                  [state]="cardState(r.widget)"
                  [series]="telemetry.seriesFor(r.widget)"
                  [span]="telemetry.spanFor(r.widget)"
                  [items]="store.activityFor(r.widget.controller)"
                  [actuatable]="isActuatable(r.widget)"
                  [held]="actuatorHeld(r.widget)"
                  [phase]="actuatorPhase(r.widget)?.phase ?? null"
                  [phaseReason]="actuatorPhase(r.widget)?.reason ?? ''"
                  [actuatorKind]="actuatorFor(r.widget)?.kind ?? ''"
                  [historyLoaded]="telemetry.loadedFor(r.widget)"
                  (toggle)="toggleWidgetActuator(r.widget)"
                  (spanChange)="onSpanChange(r.widget, $event)"
                  (expand)="onExpand(r.widget)"
                />
              }
              @case ('usage') {
                <app-usage-totals [spec]="store.spec()" />
              }
              @case ('health') {
                <app-health-history [siteId]="siteId" />
              }
              @case ('billing-outstanding') {
                <app-billing-outstanding [siteId]="siteId" />
              }
              @case ('meter-valve') {
                <app-meter-valve [siteId]="siteId" />
              }
            }
          }
        </ng-template>
      }
    </div>
  `,
})
export class DashboardComponent implements OnDestroy {
  private route = inject(ActivatedRoute);
  private backend = inject(BackendService);
  private auth = inject(AuthStore);
  private flags = inject(FeatureFlagsService);
  protected store = inject(DashboardStore);
  protected telemetry = inject(TelemetryStore);
  protected lifecycle = inject(CommandLifecycleStore);
  private capabilitiesService = inject(CapabilitiesService);
  private layouts = inject(DashboardLayoutService);

  /** Device-mode build (served from the controller's flash): the cloud-only
   *  surfaces — history charts, water usage, health history, billing, docs,
   *  the site-default layout — are hidden; the registry's `cloudOnly` filter
   *  drops the chart/usage/health widgets. Routes, tank levels, valves/pumps,
   *  the live map, command tracking and the Activity feed (the snapshot's
   *  on-device event ring) stay. */
  protected deviceMode = inject(DEVICE_MODE);

  /** Tenant-billing header link: feature-flag gated (same as the old dashboard). */
  protected billingEnabled = computed(() => this.flags.isEnabled('billing_module'));

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

  // --- Layout (registry + capabilities + stored layout) ---------------------

  /** The site's capability state; empty until loaded and on failure, so
   *  entitled widgets fail CLOSED (hidden) rather than flashing in. */
  private capState: Signal<CapabilitiesState> = signal<CapabilitiesState>('loading');
  /** The registry filtered to what this site is entitled to and what this build
   *  serves (cloud-only widgets drop out on the device build). */
  private entitledDefs = computed<WidgetDef[]>(() => {
    const s = this.capState();
    return filterForBuild(filterByEntitlement(WIDGET_DEFS, Array.isArray(s) ? s : []), this.deviceMode);
  });
  /** The stored layout (cache first for instant paint, then the PB row). */
  private storedLayout = signal<LayoutItem[] | null>(null);

  /** Phone form factor (<640px), read once like the old dashboard's cards-on-
   *  mobile default (SSR defaults to mobile): the map starts hidden there —
   *  the cards are the phone's monitoring surface. */
  private readonly mobile = signal(
    typeof window === 'undefined' ? true : window.matchMedia('(max-width: 639.98px)').matches,
  );

  /** The effective layout AND the per-instance render instruction, resolved in
   *  ONE pass: the stored layout wins where it has entries, the auto-derived
   *  default fills the rest; entitlement-filtered defs drop out; and an
   *  instance whose subject vanished (`resolveRender` → null, e.g. a stored
   *  entry for a since-removed route) drops OUT of the layout instead of
   *  occupying a dead grid cell (invisible slot in view mode, ghost chrome in
   *  edit mode). Zone labels are re-derived from the widget id at render
   *  time — a function of the widget, never stored state. */
  private resolved = computed(() => {
    const defs = this.entitledDefs();
    const allowed = new Set(defs.map((d) => d.id));
    const spec = this.store.spec();
    const derived = buildDefaultLayout(spec, defs, { mobile: this.mobile() });
    const items: LayoutItem[] = [];
    const renders = new Map<string, WidgetRender>();
    for (const i of resolveLayout(this.storedLayout(), derived)) {
      if (!allowed.has(i.widgetId)) continue;
      const r = resolveRender(i, spec, defs);
      if (!r) continue;
      const item = { ...i, section: WIDGET_ZONE[i.widgetId] };
      items.push(item);
      renders.set(item.instanceId, r);
    }
    return { items, renders };
  });
  protected layout = computed<LayoutItem[]>(() => this.resolved().items);

  // --- Attention (state-driven, above everything) ---------------------------

  /** What needs the operator's eyes RIGHT NOW: faults, offline controllers,
   *  a live safety override. Empty when the system is calm — no chrome begging
   *  for attention when nothing is wrong. Rendered above the grid. */
  protected attention = computed<{ tone: 'error' | 'warning' | 'info'; text: string }[]>(() => {
    const out: { tone: 'error' | 'warning' | 'info'; text: string }[] = [];
    for (const c of this.store.spec().controllers) {
      if (!this.store.presence(c.controller).online) {
        out.push({ tone: 'info', text: `${c.name} is offline — controls are disabled; showing the last known state.` });
      }
      if (this.store.overrideOn(c.controller)) {
        out.push({ tone: 'warning', text: `Safety override is ON on ${c.name} — level gates and watchdogs are bypassed. Turn it off in Setup when you're done.` });
      }
      for (const r of c.routes) {
        const st = this.store.routeState(c.controller, r.routeId);
        if (st?.token === 'FAULT') {
          const reason = st.reason ? describeState({ ...FAULT_MEANINGS, ...STOP_REASON_MEANINGS }, st.reason).label : '';
          out.push({ tone: 'error', text: `Fault on ${routeLabel(r, r.routeId)}${reason ? ` — ${reason}` : ''}. Reset it from the route card.` });
        }
      }
    }
    return out;
  });

  /** instanceId → render instruction, from the same pass that built the layout
   *  (dead instances are already excluded, so a miss renders nothing). */
  private renderMap = computed(() => this.resolved().renders);
  protected renderFor(item: LayoutItem): WidgetRender | null {
    return this.renderMap().get(item.instanceId) ?? null;
  }

  // --- Edit mode (layout customization) -------------------------------------

  /** Edit mode on/off. Edits stage in {@link draft} until Save. */
  protected editing = signal(false);
  /** The in-progress layout while editing; null outside edit mode. */
  protected draft = signal<LayoutItem[] | null>(null);
  /** What the grid renders: the draft while editing, else the resolved layout. */
  protected gridItems = computed<LayoutItem[]>(() => this.draft() ?? this.layout());
  /** Site co-owner ids from the site record — gates "Set as site default"
   *  (the collection rules enforce it server-side too). */
  private siteOwners = signal<string[]>([]);
  protected isSiteOwner = computed(() => {
    const me = this.auth.user()?.id;
    return !!me && this.siteOwners().includes(me);
  });
  protected saveBusy = signal(false);
  /** Brief inline confirmation after a save/reset; auto-clears. */
  protected saveMsg = signal<string | null>(null);
  /** Save/reset failure — edits are kept, shown inside the edit panel. */
  protected saveError = signal<string | null>(null);
  private saveMsgTimer = 0;

  protected startCustomize(): void {
    this.draft.set(this.layout());
    this.saveError.set(null);
    this.editing.set(true);
  }

  protected cancelEdit(): void {
    this.draft.set(null);
    this.saveError.set(null);
    this.editing.set(false);
  }

  protected onItemsChange(items: LayoutItem[]): void {
    this.draft.set(items);
  }

  /** The picker's show/hide toggle for one widget. */
  protected toggleHidden(item: LayoutItem): void {
    const d = this.draft();
    if (!d) return;
    this.draft.set(d.map((i) => (i.instanceId === item.instanceId ? { ...i, hidden: !i.hidden } : i)));
  }

  /** A widget's human label in the picker (its card/route title, else the def's). */
  protected labelFor(item: LayoutItem): string {
    const r = this.renderFor(item);
    if (!r) return item.instanceId;
    switch (r.kind) {
      case 'telemetry': return r.widget.title;
      case 'route': return routeLabel(r.route, r.route.routeId);
      default: return r.def.title;
    }
  }

  /** Save the draft — 'user' = the caller's personal layout (self-service);
   *  'site' = the shared site default (owners only, UI- and server-side). On
   *  error the draft is kept so no edit is lost. */
  protected async saveLayout(scope: 'user' | 'site'): Promise<void> {
    const d = this.draft();
    if (!d || this.saveBusy()) return;
    this.gen++; // a layout load started earlier must not overwrite what we save
    this.saveBusy.set(true);
    this.saveError.set(null);
    try {
      await this.layouts.save(this.siteId, d, scope);
      this.storedLayout.set(d);
      this.draft.set(null);
      this.editing.set(false);
      this.flash(scope === 'site' ? 'Saved as the site default layout.' : 'Layout saved.');
    } catch (e) {
      this.saveError.set(`Could not save — your edits are still here. ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      this.saveBusy.set(false);
    }
  }

  /** Forget all saved layouts (the caller's, plus the site default for owners)
   *  and fall back to the auto-derived one. */
  protected async resetLayout(): Promise<void> {
    if (this.saveBusy()) return;
    this.gen++; // a layout load started earlier must not overwrite the reset
    this.saveBusy.set(true);
    this.saveError.set(null);
    try {
      await this.layouts.reset(this.siteId, this.isSiteOwner());
      // Re-resolve what remains (a site default may still apply for non-owners).
      const gen = this.gen;
      const fresh = await this.layouts.load(this.siteId);
      if (gen !== this.gen) return; // the site switched mid-reset
      this.storedLayout.set(fresh);
      this.draft.set(null);
      this.editing.set(false);
      this.flash('Reset to the automatic layout.');
    } catch (e) {
      this.saveError.set(`Could not reset — ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      this.saveBusy.set(false);
    }
  }

  private flash(msg: string): void {
    this.saveMsg.set(msg);
    clearTimeout(this.saveMsgTimer);
    this.saveMsgTimer = setTimeout(() => this.saveMsg.set(null), 4000) as unknown as number;
  }

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
  protected ctrlName(id: string): string { return this.ctrlMeta().get(id)?.name ?? id; }
  protected ctrlColor(id: string): string { return this.ctrlMeta().get(id)?.color ?? '#94a3b8'; }

  // --- Device presence (the compact status bar) ----------------------------
  protected onlineCount = computed(() =>
    this.store.spec().controllers.filter((c) => this.store.presence(c.controller).online).length,
  );
  protected totalControllers = computed(() => this.store.spec().controllers.length);

  // --- Routes (the live control surface) ------------------------------------
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

  // --- Inline actuator control --------------------------------------------
  // A valve/pump widget reads the same sensor its actuator reports on, so the
  // status card *is* the control: click to hold open / run (claim) or release.
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
  /** Toggleable now: an actuator exists, control is held, and the device is online. */
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
  /** Valve/pump control cards render dense (the glyph grid look); charts full. */
  protected denseWidget(w: DashboardWidget): boolean {
    return w.kind === 'valve' || !!this.actuatorFor(w);
  }

  /**
   * Boot generation: a monotonically increasing counter bumped on every site
   * switch AND on every layout save/reset. Every async resolution (the layout
   * load, the site load) applies its result only when the generation it
   * started under is still current — a late resolution can never overwrite a
   * newer save or land on the wrong site.
   */
  private gen = 0;

  /** siteLoad failure — rendered where the store's own error shows. */
  protected loadError = signal<string | null>(null);

  private paramSub: { unsubscribe(): void } | null = null;

  constructor() {
    // Route REUSE: navigating /site/A/dashboard → /site/B/dashboard keeps this
    // component alive, so the site id comes from the param observable, and
    // every change re-boots the whole page — stores included — for the new site.
    this.paramSub = this.route.paramMap.subscribe((params) => this.boot(params.get('name') ?? ''));
  }

  ngOnDestroy(): void {
    this.paramSub?.unsubscribe();
    clearTimeout(this.saveMsgTimer);
  }

  /**
   * (Re)boot the dashboard for a site: tear down the previous site's state —
   * the component-provided stores (their ngOnDestroy does NOT fire on route
   * reuse), any unsaved layout draft, every per-site signal — then run the
   * load sequence for the new site. Runs on construction and on every
   * /site/:name change.
   */
  private boot(siteId: string): void {
    this.gen++; // invalidate every in-flight async resolution from the old site
    this.store.reset();
    this.telemetry.reset();
    this.lifecycle.switchSite(siteId);
    this.siteId = siteId;
    this.siteName.set('');
    this.note.set(null);
    this.topology.set(null);
    this.loadError.set(null);
    this.adminViewing.set(false);
    this.controlEnabled.set(false);
    this.siteOwners.set([]);
    this.runStartLevel.clear();
    this.cancelEdit(); // drop any unsaved layout draft (and its save error)
    this.saveMsg.set(null);
    clearTimeout(this.saveMsgTimer);
    this.storedLayout.set(null);
    if (!siteId) return;
    this.capState = this.capabilitiesService.capabilities(siteId);
    // Cache first for instant paint, then the PB row replaces it (or clears
    // it — a layout deleted elsewhere must not resurrect from the cache).
    this.storedLayout.set(this.layouts.cached(siteId));
    const gen = this.gen;
    void this.layouts.load(siteId).then((l) => {
      if (gen === this.gen) this.storedLayout.set(l);
    });
    void this.load(gen);
  }

  private async load(gen: number): Promise<void> {
    try {
      const { site, topology } = await this.backend.siteLoad(this.siteId);
      if (gen !== this.gen) return; // a newer boot superseded this load
      this.siteName.set(site.friendlyName);
      // Admin/partner looking at a site they're not a co-owner of → start read-only.
      const me = this.auth.user()?.id;
      this.adminViewing.set(this.auth.isManager() && !(!!me && (site.owners?.includes(me) ?? false)));
      this.siteOwners.set(site.owners ?? []);
      const topo = topology ? parseTopology(topology) : createEmptySiteTopology();
      this.topology.set(topo);
      const spec = buildDashboardSpec(topo);
      await this.store.init(this.siteId, spec, { update_interval: topo.timing.update_interval }, site.owners ?? [], site.people ?? []);
      if (gen !== this.gen) return;
      // Backfill history for the charted widgets (line + flow rate). Each uses its
      // own remembered span (telemetry.load defaults to the widget's stored span).
      // Device mode has no history endpoint — nothing to backfill.
      if (!this.deviceMode) {
        for (const w of spec.widgets) {
          if (w.kind === 'line' || w.kind === 'flow') void this.telemetry.load(this.siteId, w);
        }
      }
    } catch (e) {
      if (gen !== this.gen) return; // the newer boot owns the error surface now
      // Without this the spinner would stay up forever: store.init (which owns
      // the loading flag) either never ran or already cleared it on its own
      // failure path — clearing again is harmless.
      this.store.loading.set(false);
      this.loadError.set(e instanceof Error ? e.message : String(e));
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
}
