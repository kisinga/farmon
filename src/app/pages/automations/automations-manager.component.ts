import { Component, computed, effect, inject, input, signal } from '@angular/core';
import type { UnsubscribeFunc } from 'pocketbase';
import {
  parseTopology, listAutomatableRoutes, buildDashboardSpec, MAX_AUTOMATIONS,
  type SiteTopology, type AutomatableRoute, type NewAutomationRow,
} from '@core';
import { BackendService } from '../../core/services/backend.service';
import { AuthStore } from '../../core/services/auth.store';
import { ConfirmService } from '../../core/services/confirm.service';
import { DashboardStore } from '../dashboard/dashboard.store';
import { CommandLifecycleStore } from '../dashboard/command-lifecycle.store';
import { TunableNumbersComponent } from '../dashboard/widgets/tunable-numbers.component';
import { AutomationsService, type AutomationRecord } from './automations.service';

const DAY_LABELS = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'];

/** One overridable run-param. Bits + bounds mirror routes.ts (OV_*) and
 *  tunable-numbers.ts; the editor overlays them onto the route's live defaults. */
interface OverrideField {
  key: keyof NewAutomationRow;
  bit: number;
  label: string;
  unit: string;
  min: number;
  max: number;
  monitoredOnly?: boolean;
}
const OVERRIDE_FIELDS: OverrideField[] = [
  { key: 'ov_target_volume_l', bit: 16, label: 'Target volume', unit: 'L', min: 0, max: 100000, monitoredOnly: true },
  { key: 'ov_target_duration_s', bit: 8, label: 'Run duration', unit: 's', min: 0, max: 7200 },
  { key: 'ov_max_runtime_min', bit: 4, label: 'Max runtime', unit: 'min', min: 1, max: 120 },
  { key: 'ov_source_min_pct', bit: 1, label: 'Source min', unit: '%', min: 0, max: 100 },
  { key: 'ov_dest_max_pct', bit: 2, label: 'Dest max', unit: '%', min: 0, max: 100 },
];

/** A blank draft for a new automation (route stamped on save). */
function blankDraft(): NewAutomationRow & { id?: string } {
  return {
    site: '', controller: '', name: '', route_key: '', route_index: 0, route_set_version: 0,
    trigger_type: 'time', time_min: 6 * 60, days_mask: 0, level_threshold_pct: 50,
    override_mask: 0, ov_source_min_pct: 0, ov_dest_max_pct: 0,
    ov_max_runtime_min: 30, ov_target_duration_s: 1800, ov_target_volume_l: 500, enabled: true,
  };
}

/**
 * AutomationsManagerComponent - the reusable automation manager: lists, creates,
 * edits and deletes automations as first-class rows in the `automations` collection
 * (server republishes the retained set to the device on every change). Route
 * selection stamps the owning controller + route_index + route_set_version; each
 * automation can override the route's run-params (volume, duration, max-runtime,
 * level setpoints) via a sparse overlay. Operational, gated by ownership.
 *
 * Self-contained: give it a {@link siteId} and it loads the topology (for routes
 * and route-default tunables) and the automation rows itself. Hosted both by the
 * standalone `/site/:name/automations` page and by the dashboard's Automations
 * modal, so the two share one editor. Provides its own DashboardStore so it works
 * outside the dashboard injector.
 */
@Component({
  selector: 'app-automations-manager',
  standalone: true,
  imports: [TunableNumbersComponent],
  providers: [DashboardStore, CommandLifecycleStore],
  host: { class: 'block' },
  template: `
    <div class="flex flex-col gap-4">
      @if (error()) { <div role="alert" class="alert alert-error text-sm py-2">{{ error() }}</div> }

      <!-- Top actions: count vs cap + New. -->
      @if (canEdit()) {
        <div class="flex items-center justify-between gap-2">
          <span class="text-[11px] text-base-content/40">{{ rows().length }}/{{ maxAutomations }} automations</span>
          <button class="btn btn-sm btn-primary gap-1 shrink-0" (click)="startNew()"
                  [disabled]="!routes().length || atCap() || !!draft()"
                  [title]="atCap() ? 'Limit reached (' + maxAutomations + ')' : ''">
            <span class="text-base leading-none -mt-px">+</span> New
          </button>
        </div>
      }

      <!-- Route defaults: the per-route values an automation inherits unless it
           overrides them. Collapsed by default, edit-gated - same as the dashboard. -->
      @if (hasRouteTuning()) {
        <details class="group rounded-2xl ring-1 ring-base-300/40 bg-base-100 overflow-hidden">
          <summary class="cursor-pointer list-none flex items-center justify-between gap-3 px-4 h-12 hover:bg-base-200/30 transition-colors">
            <span class="flex items-baseline gap-2 min-w-0">
              <span class="text-sm font-semibold">Route defaults</span>
              <span class="text-xs text-base-content/40 truncate hidden sm:inline">per-route runtime, volume, duration &amp; levels</span>
            </span>
            <svg class="w-4 h-4 text-base-content/40 shrink-0 transition-transform group-open:rotate-180" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6" /></svg>
          </summary>
          <div class="px-4 pb-4 pt-3 border-t border-base-300/40">
            <app-tunable-numbers [controllers]="dash.spec().controllers" [canEdit]="canEdit()" scope="route" />
          </div>
        </details>
      }

      <!-- Editor -->
      @if (draft(); as d) {
        <section class="rounded-2xl ring-1 ring-primary/40 bg-base-100 shadow-lg overflow-hidden">
          <div class="flex items-center justify-between px-4 h-11 border-b border-base-300/40">
            <h2 class="text-sm font-semibold">{{ d.id ? 'Edit automation' : 'New automation' }}</h2>
            <button class="btn btn-ghost btn-xs btn-circle" (click)="cancel()" title="Cancel" aria-label="Cancel">✕</button>
          </div>

          <div class="p-4 grid grid-cols-1 lg:grid-cols-2 gap-x-6 gap-y-5">
            <!-- Left: identity + trigger -->
            <div class="flex flex-col gap-4">
              <label class="flex flex-col gap-1">
                <span class="text-[11px] font-medium text-base-content/50">Name</span>
                <input class="input input-sm input-bordered" [value]="d.name" (input)="set('name', $any($event.target).value)" placeholder="Morning fill" />
              </label>
              <label class="flex flex-col gap-1">
                <span class="text-[11px] font-medium text-base-content/50">Route</span>
                <select class="select select-sm select-bordered" [value]="d.route_key" (change)="onRoute($any($event.target).value)">
                  <option value="" disabled>Select a route…</option>
                  @if (multiController()) {
                    @for (g of routeGroups(); track g.controller) {
                      <optgroup [label]="g.controller">
                        @for (r of g.routes; track r.routeKey) { <option [value]="r.routeKey">{{ r.routeName }}</option> }
                      </optgroup>
                    }
                  } @else {
                    @for (r of routes(); track r.routeKey) { <option [value]="r.routeKey">{{ r.routeName }}</option> }
                  }
                </select>
              </label>

              <div class="flex flex-col gap-2">
                <span class="text-[11px] font-semibold uppercase tracking-wider text-base-content/40">When</span>
                <div class="inline-flex w-fit rounded-lg bg-base-200 p-0.5">
                  <button class="btn btn-xs btn-ghost rounded-md normal-case" [class.bg-base-100]="d.trigger_type === 'time'" [class.shadow-sm]="d.trigger_type === 'time'" (click)="set('trigger_type', 'time')">Time of day</button>
                  <button class="btn btn-xs btn-ghost rounded-md normal-case" [class.bg-base-100]="d.trigger_type === 'level'" [class.shadow-sm]="d.trigger_type === 'level'" [disabled]="!selectedRoute()?.hasLevelSource" (click)="set('trigger_type', 'level')">Tank level</button>
                </div>
                @if (d.trigger_type === 'time') {
                  <div class="flex items-center gap-2 flex-wrap pt-0.5">
                    <input type="time" class="input input-sm input-bordered w-32" [value]="hhmm(d.time_min)" (input)="setTime($any($event.target).value)" />
                    <div class="flex flex-wrap gap-1">
                      @for (day of dayLabels; track day; let i = $index) {
                        <button class="btn btn-xs btn-circle w-8 h-8 min-h-0 font-normal" [class.btn-primary]="dayOn(d.days_mask, i)" [class.btn-ghost]="!dayOn(d.days_mask, i)" (click)="toggleDay(i)" [title]="day">{{ day.charAt(0) }}</button>
                      }
                    </div>
                    @if (d.days_mask === 0) { <span class="text-[11px] text-base-content/40">every day</span> }
                  </div>
                } @else {
                  <div class="flex items-center gap-2 text-sm pt-0.5">
                    <span class="text-base-content/60">When source rises above</span>
                    <input type="number" min="0" max="100" class="input input-sm input-bordered w-20 text-right" [value]="d.level_threshold_pct" (input)="set('level_threshold_pct', num($event))" />
                    <span class="text-base-content/40">%</span>
                  </div>
                }
              </div>
            </div>

            <!-- Right: run settings -->
            <div class="flex flex-col gap-2">
              <span class="text-[11px] font-semibold uppercase tracking-wider text-base-content/40">Run settings</span>
              <div class="rounded-xl ring-1 ring-base-300/40 px-3 divide-y divide-base-300/40">
                @for (f of overrideFields(); track f.key) {
                  <div class="flex items-center gap-3 py-2">
                    <label class="flex items-center gap-2.5 flex-1 min-w-0 cursor-pointer select-none">
                      <input type="checkbox" class="toggle toggle-xs" [checked]="ovOn(d.override_mask, f.bit)" (change)="toggleOverride(f.bit)" />
                      <span class="text-sm truncate">{{ f.label }}</span>
                    </label>
                    @if (ovOn(d.override_mask, f.bit)) {
                      <div class="flex items-center gap-1.5 shrink-0">
                        <input type="number" [min]="f.min" [max]="f.max" class="input input-sm input-bordered w-24 text-right" [value]="d[f.key]" (input)="set(f.key, num($event))" />
                        <span class="text-xs text-base-content/40 w-7">{{ f.unit }}</span>
                      </div>
                    } @else {
                      <span class="text-xs text-base-content/35 shrink-0 italic">route default</span>
                    }
                  </div>
                }
              </div>
            </div>

            <!-- Footer -->
            <div class="lg:col-span-2 pt-3 border-t border-base-300/40">
              @if (draftIssues().length) {
                <ul class="mb-3 text-[11px] text-error/90 list-disc pl-4 space-y-0.5">
                  @for (e of draftIssues(); track e) { <li>{{ e }}</li> }
                </ul>
              }
              <div class="flex items-center justify-between gap-2">
                <label class="flex items-center gap-2 text-sm cursor-pointer select-none">
                  <input type="checkbox" class="toggle toggle-sm toggle-success" [checked]="d.enabled" (change)="set('enabled', $any($event.target).checked)" />
                  <span class="text-base-content/70">{{ d.enabled ? 'Enabled' : 'Paused' }}</span>
                </label>
                <div class="flex gap-2">
                  <button class="btn btn-ghost btn-sm" (click)="cancel()">Cancel</button>
                  <button class="btn btn-primary btn-sm min-w-20" (click)="save()" [disabled]="draftIssues().length > 0 || saving()">
                    @if (saving()) { <span class="loading loading-spinner loading-xs"></span> } Save
                  </button>
                </div>
              </div>
            </div>
          </div>
        </section>
      }

      <!-- List -->
      @if (loading()) {
        <div class="flex justify-center py-10"><span class="loading loading-spinner text-base-content/30"></span></div>
      } @else if (!routes().length) {
        <div class="rounded-2xl ring-1 ring-base-300/40 bg-base-100 px-4 py-10 text-center">
          <p class="text-sm text-base-content/50">No routes to automate yet.</p>
          <p class="text-xs text-base-content/40 mt-1">Add routes in the site design first.</p>
        </div>
      } @else {
        <ul class="flex flex-col gap-2">
          @for (a of rows(); track a.id) {
            <li class="rounded-2xl ring-1 ring-base-300/40 bg-base-100 px-4 py-3 flex items-center gap-3 transition-opacity"
                [class.opacity-55]="!a.enabled">
              <span class="w-2 h-2 rounded-full shrink-0" [class]="a.enabled ? 'bg-success' : 'bg-base-content/25'"></span>
              <div class="min-w-0 flex-1">
                <div class="flex items-center gap-2">
                  <span class="font-medium text-sm truncate">{{ a.name || 'Untitled automation' }}</span>
                  @if (!a.enabled) { <span class="badge badge-ghost badge-sm shrink-0">Paused</span> }
                </div>
                <p class="text-xs text-base-content/50 truncate mt-0.5">{{ routeName(a.route_key) }} · {{ triggerSummary(a) }}{{ overrideSummary(a) }}</p>
              </div>
              @if (canEdit()) {
                <div class="flex items-center gap-1 shrink-0">
                  <input type="checkbox" class="toggle toggle-sm toggle-success" [checked]="a.enabled" (change)="toggleEnabled(a)" [title]="a.enabled ? 'Pause' : 'Resume'" />
                  <button class="btn btn-ghost btn-sm" (click)="startEdit(a)">Edit</button>
                  <button class="btn btn-ghost btn-sm text-error/70 hover:text-error hover:bg-error/10" (click)="remove(a)">Delete</button>
                </div>
              }
            </li>
          } @empty {
            <li class="rounded-2xl ring-1 ring-base-300/40 border-dashed bg-base-100/60 px-4 py-10 text-center list-none">
              <p class="text-sm text-base-content/50">No automations yet.</p>
              @if (canEdit()) { <p class="text-xs text-base-content/40 mt-1">Create one to run a route by time or tank level.</p> }
            </li>
          }
        </ul>
      }
    </div>
  `,
})
export class AutomationsManagerComponent {
  /** Site whose automations this manages. Drives the one-time load. */
  readonly siteId = input.required<string>();

  private backend = inject(BackendService);
  private auth = inject(AuthStore);
  private svc = inject(AutomationsService);
  private confirm = inject(ConfirmService);
  protected dash = inject(DashboardStore);

  protected rows = signal<AutomationRecord[]>([]);
  protected routes = signal<AutomatableRoute[]>([]);
  protected draft = signal<(NewAutomationRow & { id?: string }) | null>(null);
  protected loading = signal(true);
  protected saving = signal(false);
  protected error = signal('');
  protected readonly dayLabels = DAY_LABELS;
  protected readonly maxAutomations = MAX_AUTOMATIONS;

  private topology: SiteTopology | null = null;
  /** Signal (not a plain field) so `canEdit` recomputes once `load()` resolves
   *  ownership. As a plain field it stayed stale in the modal, where auth is
   *  already settled and nothing else forced the computed to re-run. */
  private isOwner = signal(false);
  private started = false;
  private unsub?: UnsubscribeFunc;

  protected canEdit = computed(() => this.isOwner() || this.auth.isAdmin());
  protected atCap = computed(() => this.rows().length >= MAX_AUTOMATIONS);
  /** Any per-route tunable exists (drives the "Route defaults" disclosure). */
  protected hasRouteTuning = computed(() => this.dash.spec().controllers.some((c) => c.tunables.some((t) => t.scope === 'route')));
  protected selectedRoute = computed(() => this.routes().find((r) => r.routeKey === this.draft()?.route_key));
  protected overrideFields = computed(() =>
    OVERRIDE_FIELDS.filter((f) => !f.monitoredOnly || this.selectedRoute()?.monitored),
  );
  protected routeGroups = computed(() => {
    const groups = new Map<string, AutomatableRoute[]>();
    for (const r of this.routes()) {
      const arr = groups.get(r.controllerId) ?? [];
      arr.push(r);
      groups.set(r.controllerId, arr);
    }
    return [...groups.entries()].map(([controller, routes]) => ({ controller, routes }));
  });
  protected multiController = computed(() => this.routeGroups().length > 1);

  /** Pre-submit validation: what still blocks Save, in plain words. */
  protected draftIssues = computed<string[]>(() => {
    const d = this.draft();
    if (!d) return [];
    const issues: string[] = [];
    if (!d.route_key) issues.push('Pick a route.');
    if (d.trigger_type === 'level') {
      const t = d.level_threshold_pct;
      if (t == null || Number.isNaN(t) || t < 0 || t > 100) issues.push('Tank level must be between 0 and 100%.');
    }
    for (const f of this.overrideFields()) {
      if (!this.ovOn(d.override_mask, f.bit)) continue;
      const v = Number(d[f.key]);
      if (Number.isNaN(v) || v < f.min || v > f.max) issues.push(`${f.label} must be ${f.min}–${f.max} ${f.unit}.`);
    }
    return issues;
  });

  constructor() {
    // Load once the bound siteId is available (it's set once, so guard re-runs).
    effect(() => {
      const id = this.siteId();
      if (id && !this.started) { this.started = true; void this.load(id); }
    });
  }

  private async load(siteId: string): Promise<void> {
    try {
      const { site, topology } = await this.backend.siteLoad(siteId);
      const me = this.auth.user()?.id;
      this.isOwner.set(!!me && (site.owners?.includes(me) ?? false));
      if (topology) {
        this.topology = parseTopology(topology);
        this.routes.set(listAutomatableRoutes(this.topology));
        // Live per-route tunables (the "Route defaults" the automations override)
        // ride the same dashboard store + config_set pipe as on the dashboard.
        await this.dash.init(siteId, buildDashboardSpec(this.topology));
      }
      this.rows.set(await this.svc.list(siteId));
      this.unsub = await this.svc.subscribe(siteId, () => void this.refresh());
    } catch (e) {
      this.error.set(e instanceof Error ? e.message : 'Failed to load automations.');
    } finally {
      this.loading.set(false);
    }
  }

  private async refresh(): Promise<void> {
    try { this.rows.set(await this.svc.list(this.siteId())); } catch { /* transient */ }
  }

  ngOnDestroy(): void { this.unsub?.(); }

  // --- editor state ---
  protected startNew(): void { const d = blankDraft(); d.site = this.siteId(); this.draft.set(d); }
  protected startEdit(a: AutomationRecord): void { this.draft.set({ ...a }); }
  protected cancel(): void { this.draft.set(null); }

  protected set<K extends keyof NewAutomationRow>(key: K, val: NewAutomationRow[K]): void {
    const d = this.draft(); if (!d) return; this.draft.set({ ...d, [key]: val });
  }
  protected num(e: Event): number { return Number((e.target as HTMLInputElement).value) || 0; }

  protected onRoute(key: string): void {
    const r = this.routes().find((x) => x.routeKey === key); const d = this.draft();
    if (!r || !d) return;
    const next = { ...d, route_key: r.routeKey, controller: r.controllerId, route_index: r.routeIndex, route_set_version: r.routeSetVersion };
    // A level trigger needs a level source; fall back to time if the new route lacks one.
    if (next.trigger_type === 'level' && !r.hasLevelSource) next.trigger_type = 'time';
    this.draft.set(next);
  }

  protected hhmm(min: number): string {
    const h = Math.floor(min / 60), m = min % 60;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  }
  protected setTime(v: string): void {
    const [h, m] = v.split(':').map((n) => parseInt(n, 10));
    if (!Number.isNaN(h) && !Number.isNaN(m)) this.set('time_min', h * 60 + m);
  }
  protected dayOn(mask: number, i: number): boolean { return (mask & (1 << i)) !== 0; }
  protected toggleDay(i: number): void { const d = this.draft(); if (d) this.set('days_mask', d.days_mask ^ (1 << i)); }
  protected ovOn(mask: number, bit: number): boolean { return (mask & bit) !== 0; }
  protected toggleOverride(bit: number): void { const d = this.draft(); if (d) this.set('override_mask', d.override_mask ^ bit); }

  protected async save(): Promise<void> {
    const d = this.draft(); if (!d || !d.route_key) return;
    this.saving.set(true);
    try {
      const { id, ...row } = d;
      if (id) await this.svc.update(id, row); else await this.svc.create(row);
      this.draft.set(null);
      await this.refresh();
    } catch (e) {
      this.error.set(e instanceof Error ? e.message : 'Save failed.');
    } finally {
      this.saving.set(false);
    }
  }

  protected async toggleEnabled(a: AutomationRecord): Promise<void> {
    try { await this.svc.update(a.id, { enabled: !a.enabled }); await this.refresh(); }
    catch (e) { this.error.set(e instanceof Error ? e.message : 'Update failed.'); }
  }

  protected async remove(a: AutomationRecord): Promise<void> {
    const ok = await this.confirm.confirm({
      title: 'Delete automation',
      message: `Delete automation "${a.name || 'unnamed'}"? This can't be undone.`,
      confirmLabel: 'Delete',
      variant: 'error',
    });
    if (!ok) return;
    try { await this.svc.remove(a.id); await this.refresh(); }
    catch (e) { this.error.set(e instanceof Error ? e.message : 'Delete failed.'); }
  }

  // --- list display ---
  protected routeName(key: string): string { return this.routes().find((r) => r.routeKey === key)?.routeName ?? key; }
  protected triggerSummary(a: AutomationRecord): string {
    if (a.trigger_type === 'level') return `when source > ${a.level_threshold_pct}%`;
    const days = a.days_mask === 0 ? 'daily' : DAY_LABELS.filter((_, i) => a.days_mask & (1 << i)).join(' ');
    return `${this.hhmm(a.time_min)} ${days}`;
  }
  protected overrideSummary(a: AutomationRecord): string {
    const parts: string[] = [];
    if (a.override_mask & 16) parts.push(`${a.ov_target_volume_l}L`);
    if (a.override_mask & 8) parts.push(`${a.ov_target_duration_s}s`);
    if (a.override_mask & 4) parts.push(`≤${a.ov_max_runtime_min}min`);
    return parts.length ? ` · ${parts.join(' ')}` : '';
  }
}
