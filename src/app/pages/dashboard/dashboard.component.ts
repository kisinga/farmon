import { Component, computed, inject, signal } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { buildDashboardSpec, parseTopology, type CommandAction, type DashboardWidget } from '@core';
import { BackendService } from '../../core/services/backend.service';
import { AuthStore } from '../../core/services/auth.store';
import { DashboardStore } from './dashboard.store';
import { TelemetryStore } from './telemetry.store';
import { DashboardCardComponent } from './widgets/dashboard-card.component';

/**
 * Customer dashboard for a site (`/site/:name/dashboard`, where `:name` is the
 * site id). Builds the chart spec in the browser from the saved topology, then
 * renders live widgets from the shadow + transition log and a per-controller
 * command bar. Runtime state group only — it must not import the editor
 * services (WorkspaceService / SystemEditorService).
 */
@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [DashboardCardComponent],
  providers: [DashboardStore, TelemetryStore],
  host: { class: 'flex-1 overflow-auto' },
  template: `
    <div class="max-w-6xl mx-auto w-full px-6 py-6">
      <!-- Bright hero band -->
      <div class="relative overflow-hidden rounded-2xl mb-6 ring-1 ring-white/10
                  bg-gradient-to-br from-cyan-500/15 via-sky-500/10 to-base-100">
        <div class="pointer-events-none absolute -top-16 -right-10 w-72 h-72 rounded-full bg-cyan-500/20 blur-3xl"></div>
        <div class="relative px-6 py-6 flex items-center gap-3 flex-wrap">
          <div class="flex-1 min-w-0">
            <h1 class="text-2xl font-bold tracking-tight truncate">{{ siteName() || 'Dashboard' }}</h1>
            <p class="text-sm text-base-content/60 mt-0.5">Live status &amp; control</p>
          </div>
          <span class="inline-flex items-center gap-1.5 text-xs text-cyan-300 bg-cyan-400/10 rounded-full px-2.5 py-1">
            <span class="w-1.5 h-1.5 rounded-full bg-cyan-300 animate-pulse"></span> Live
          </span>
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

        <!-- Command bar (hidden while an admin is viewing read-only) -->
        @if (canControl()) {
        @for (c of store.spec().controllers; track c.controller) {
          <div class="bg-base-100 rounded-2xl ring-1 ring-base-300/40 px-4 py-3 mb-4">
            <div class="flex items-center flex-wrap gap-2">
              <span class="text-xs font-semibold text-base-content/60 mr-1">{{ c.name }}</span>
              @for (r of c.routes; track r.routeId) {
                <div class="join">
                  <button class="btn btn-xs join-item btn-success" [disabled]="busy().has(key(c.controller,'route_start',r.routeId))"
                    (click)="cmd(c.controller,'route_start',r.routeId)">▶ {{ r.name }}</button>
                  <button class="btn btn-xs join-item" [disabled]="busy().has(key(c.controller,'route_stop',r.routeId))"
                    (click)="cmd(c.controller,'route_stop',r.routeId)">■</button>
                </div>
              }
              <span class="grow"></span>
              <button class="btn btn-xs btn-error btn-outline" [disabled]="busy().has(key(c.controller,'stop_all'))"
                (click)="cmd(c.controller,'stop_all')">Stop all</button>
              <button class="btn btn-xs btn-ghost" [disabled]="busy().has(key(c.controller,'reset_faults'))"
                (click)="cmd(c.controller,'reset_faults')">Reset faults</button>
              <button class="btn btn-xs btn-ghost" [disabled]="busy().has(key(c.controller,'clear_queue'))"
                (click)="cmd(c.controller,'clear_queue')">Clear queue</button>
            </div>
          </div>
        }
        }

        @if (note()) { <div class="text-xs text-base-content/50 mb-3">{{ note() }}</div> }

        <!-- Widgets, grouped into sections so status / levels / valves / flow /
             activity read as distinct zones instead of one jumbled grid. -->
        @for (sec of sections(); track sec.id) {
          <section class="mb-6">
            <h2 class="text-xs font-semibold uppercase tracking-wider text-base-content/40 mb-2.5">{{ sec.label }}</h2>
            <div [class]="sec.id === 'status'
                ? 'grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2'
                : 'grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4'">
              @for (w of sec.widgets; track w.id) {
                <div [class]="w.kind === 'timeline' ? 'sm:col-span-2 lg:col-span-3' : ''">
                  <app-dashboard-card
                    [widget]="w"
                    [dense]="sec.id === 'status'"
                    [controllerLabel]="showController() ? ctrlName(w.controller) : ''"
                    [controllerColor]="ctrlColor(w.controller)"
                    [row]="store.rowFor(w)"
                    [totalRow]="store.row(w.controller, w.totalSensor)"
                    [series]="telemetry.seriesFor(w)"
                    [events]="store.eventsFor(w.controller)"
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
  protected store = inject(DashboardStore);
  protected telemetry = inject(TelemetryStore);

  private siteId = '';
  protected siteName = signal('');
  protected busy = signal<Set<string>>(new Set());
  protected note = signal<string | null>(null);

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

  /** Section a widget belongs to — drives the grouped layout below. */
  private category(w: DashboardWidget): 'status' | 'levels' | 'valves' | 'flow' | 'pressure' | 'activity' {
    switch (w.kind) {
      case 'timeline': return 'activity';
      case 'valve':    return 'valves';
      case 'gauge':    return 'levels';
      case 'flow':     return 'flow';
      case 'line':     return 'pressure'; // remaining line charts are pressure/filter (psi)
      case 'stat':     return w.unit === 'L' ? 'flow' : 'status'; // stray flow totals vs queue depth
      default:         return 'status'; // badges: system state, last stop, pump, override
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
    return order.filter((c) => byCat.has(c)).map((c) => ({ id: c, label: labels[c], widgets: byCat.get(c)! }));
  });

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
    // Backfill history for the charted widgets (line + flow rate).
    for (const w of spec.widgets) {
      if (w.kind === 'line' || w.kind === 'flow') void this.telemetry.load(this.siteId, w);
    }
  }

  protected key(controller: string, action: CommandAction, routeId?: number): string {
    return `${controller}/${action}/${routeId ?? ''}`;
  }

  protected async cmd(controller: string, action: CommandAction, routeId?: number): Promise<void> {
    // Read-only admins must Take control first (the bar is hidden, but guard anyway).
    if (!this.canControl()) return;
    const k = this.key(controller, action, routeId);
    this.busy.update((s) => new Set(s).add(k));
    this.note.set(null);
    try {
      await this.backend.sendCommand(this.siteId, controller, action, routeId);
      this.note.set(`Sent ${action}${routeId != null ? ' #' + routeId : ''} to ${controller} — watching for the device to confirm…`);
    } catch (err) {
      this.note.set(String(err));
    } finally {
      this.busy.update((s) => {
        const n = new Set(s);
        n.delete(k);
        return n;
      });
    }
  }
}
