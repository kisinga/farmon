import { Component, inject, signal } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { buildDashboardSpec, parseTopology, type CommandAction } from '@core';
import { BackendService } from '../../core/services/backend.service';
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
      <div class="mb-5">
        <h1 class="text-xl font-bold tracking-tight">{{ siteName() || 'Dashboard' }}</h1>
        <p class="text-sm text-base-content/50 mt-0.5">Live status &amp; control</p>
      </div>

      @if (store.loading()) {
        <div class="flex items-center justify-center py-24"><span class="loading loading-spinner loading-lg"></span></div>
      } @else if (store.error()) {
        <div class="alert alert-error text-sm">{{ store.error() }}</div>
      } @else {
        <!-- Command bar -->
        @for (c of store.spec().controllers; track c.controller) {
          <div class="bg-base-100 rounded-xl border border-base-300/40 px-4 py-3 mb-4">
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

        @if (note()) { <div class="text-xs text-base-content/50 mb-3">{{ note() }}</div> }

        <!-- Widget grid -->
        <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          @for (w of store.spec().widgets; track w.id) {
            <div [class]="w.kind === 'timeline' ? 'sm:col-span-2 lg:col-span-3' : ''">
              <app-dashboard-card
                [widget]="w"
                [row]="store.rowFor(w)"
                [series]="telemetry.seriesFor(w)"
                [events]="store.eventsFor(w.controller)"
              />
            </div>
          }
        </div>
      }
    </div>
  `,
})
export class DashboardComponent {
  private route = inject(ActivatedRoute);
  private backend = inject(BackendService);
  protected store = inject(DashboardStore);
  protected telemetry = inject(TelemetryStore);

  private siteId = '';
  protected siteName = signal('');
  protected busy = signal<Set<string>>(new Set());
  protected note = signal<string | null>(null);

  constructor() {
    this.siteId = this.route.snapshot.paramMap.get('name') ?? '';
    if (this.siteId) void this.load();
  }

  private async load(): Promise<void> {
    const { site, topology } = await this.backend.siteLoad(this.siteId);
    this.siteName.set(site.friendlyName);
    if (!topology) {
      this.store.error.set('Site has no topology yet.');
      this.store.loading.set(false);
      return;
    }
    const spec = buildDashboardSpec(parseTopology(topology));
    await this.store.init(this.siteId, spec);
    // Backfill history for the line widgets.
    for (const w of spec.widgets) {
      if (w.kind === 'line') void this.telemetry.load(this.siteId, w);
    }
  }

  protected key(controller: string, action: CommandAction, routeId?: number): string {
    return `${controller}/${action}/${routeId ?? ''}`;
  }

  protected async cmd(controller: string, action: CommandAction, routeId?: number): Promise<void> {
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
