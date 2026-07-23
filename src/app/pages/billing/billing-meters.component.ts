import { Component, computed, inject, signal } from '@angular/core';
import { BillingService, type BillingUnit, type MeterCommand, type MeterDevice, type MeterSighting } from './billing.service';
import { BillingShellComponent } from './billing-shell.component';
import { BillingBannerComponent, BillingEmptyStateComponent, BillingPageErrorComponent } from './billing-ui';
import { formatLitres, fmtDateTime, PENDING_COPY, pbMessage } from './billing-format';

type ValveFilter = 'all' | 'open' | 'closed' | 'unknown' | 'pending';

/**
 * Billing meters: the field-ops page. Desktop (≥lg) is master-detail — a
 * dense, filterable meter list on the left, the selected meter's valve action
 * panel + command audit on the right. Mobile (<lg) shows the list only;
 * tapping a meter replaces it with the full-screen detail (back affordance
 * returns to the list) so the claim form and sightings never sit between the
 * operator and the valve.
 *
 * Valve actuation is a queued downlink, NOT a live switch: every queued/sent
 * command carries the pending copy, and the action requires typing OPEN/CLOSE
 * before its button enables (the backend enforces the same match).
 */
@Component({
  selector: 'app-billing-meters',
  standalone: true,
  imports: [BillingBannerComponent, BillingEmptyStateComponent, BillingPageErrorComponent],
  host: { class: 'block' },
  template: `
    @if (loading()) {
      <div class="flex items-center justify-center py-24"><span class="loading loading-spinner loading-lg"></span></div>
    } @else if (pageError(); as pe) {
      <app-billing-page-error [text]="pe" (retry)="reload()" />
    } @else {
      @if (status(); as st) {
        <app-billing-banner [kind]="st.ok ? 'success' : 'error'" [text]="st.text" (dismissed)="status.set(null)" />
      }

      <div class="grid grid-cols-1 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] gap-6 items-start">
        <!-- Meter list (hidden on mobile while the detail view is open) -->
        <section [class.hidden]="mobileDetail()" class="lg:block">
          <div class="flex flex-wrap items-center gap-2 mb-3">
            <h2 class="section-label">Meters</h2>
            <span class="grow"></span>
            <!-- Valve-state filter: same segmented-control idiom as the valve
                 open/close toggle. -->
            <div class="inline-flex rounded-lg bg-base-200 p-0.5 gap-0.5">
              @for (f of filters; track f.key) {
                <button class="btn btn-xs btn-ghost rounded-md normal-case tabular-nums"
                        [class.bg-base-100]="valveFilter() === f.key" [class.shadow-sm]="valveFilter() === f.key"
                        (click)="valveFilter.set(f.key)">{{ f.label }} {{ filterCount(f.key) }}</button>
              }
            </div>
          </div>
          @if (meters().length === 0) {
            <app-billing-empty-state title="No meters claimed" hint="Claim a meter by IMEI below to start tracking it." />
          } @else if (visibleMeters().length === 0) {
            <app-billing-empty-state title="No meters match this filter" />
          } @else {
            <div class="surface divide-y divide-base-300/20">
              @for (m of visibleMeters(); track m.id) {
                <button type="button" class="w-full text-left flex items-center gap-3 px-4 py-3 hover:bg-base-200/30 transition-colors"
                        [class.bg-base-200/40]="selected()?.id === m.id" (click)="select(m)">
                  <span class="w-2 h-2 rounded-full shrink-0"
                        [title]="'Valve ' + (m.valve_state || 'unknown')"
                        [class]="m.valve_state === 'open' ? 'bg-success' : m.valve_state === 'closed' ? 'bg-error' : 'bg-base-content/30'"></span>
                  <div class="flex-1 min-w-0">
                    <p class="text-sm font-medium truncate">{{ m.name || m.imei }}</p>
                    <p class="text-[11px] text-base-content/50 truncate">
                      <span class="font-mono">{{ m.imei }}</span>
                      @if (unitCode(m)) { <span> · {{ unitCode(m) }}</span> }
                    </p>
                  </div>
                  @if (pendingMeters().has(m.id)) {
                    <span class="badge badge-info badge-xs shrink-0" [title]="pendingCopy">pending</span>
                  }
                  <div class="text-right shrink-0">
                    <p class="text-sm tabular-nums">{{ litres(m.last_reading_ml) }}</p>
                    <p class="text-[11px]" [class]="stale(m) ? 'text-warning' : 'text-base-content/40'">{{ m.last_uplink_at ? dateTime(m.last_uplink_at) : 'never reported' }}</p>
                  </div>
                </button>
              }
            </div>
          }

          <!-- Claim form: below the list so it never sits between the operator
               and the valve on mobile. -->
          <h2 class="section-label mb-3 mt-6">Claim a meter</h2>
          <div class="surface px-5 py-4 flex flex-col gap-3">
            <label class="flex flex-col gap-1">
              <span class="text-[11px] font-medium text-base-content/50">IMEI</span>
              <input class="input input-sm input-bordered font-mono" inputmode="numeric" placeholder="86xxxxxxxxxxxxxx"
                     [value]="claimImei()" (input)="claimImei.set($any($event.target).value)" />
              <span class="text-[11px] text-base-content/40">15 digits, printed on the meter label.</span>
            </label>
            <label class="flex flex-col gap-1">
              <span class="text-[11px] font-medium text-base-content/50">Name (optional)</span>
              <input class="input input-sm input-bordered" placeholder="e.g. Block A meter"
                     [value]="claimName()" (input)="claimName.set($any($event.target).value)" />
            </label>
            <label class="flex flex-col gap-1">
              <span class="text-[11px] font-medium text-base-content/50">Unit (optional)</span>
              <select class="select select-sm select-bordered" [value]="claimUnit()" (change)="claimUnit.set($any($event.target).value)">
                <option value="">— unassigned —</option>
                @for (u of units(); track u.id) { <option [value]="u.id">{{ u.code }}{{ u.name ? ' — ' + u.name : '' }}</option> }
              </select>
            </label>
            <div>
              <button class="btn btn-sm btn-primary" [disabled]="!claimImei().trim() || claimBusy()" (click)="claim()">
                @if (claimBusy()) { <span class="loading loading-spinner loading-xs"></span> }
                Claim meter
              </button>
            </div>
          </div>

          <!-- Sightings: admin-only collection, hidden for owners. -->
          @if (shell.isAdmin()) {
            <h2 class="section-label mb-3 mt-6">Device sightings <span class="font-normal normal-case tracking-normal text-base-content/40">(admin)</span></h2>
            @if (sightings().length === 0) {
              <app-billing-empty-state title="No device sightings" hint="Unclaimed devices appear here when they phone home." />
            } @else {
              <div class="surface divide-y divide-base-300/20">
                @for (s of sightings(); track s.id) {
                  <div class="flex items-center gap-3 px-4 py-2.5">
                    <div class="flex-1 min-w-0">
                      <p class="text-sm font-mono truncate">{{ s.imei }}</p>
                      <p class="text-[11px] text-base-content/50 truncate">
                        @if (s.sn) { <span>SN {{ s.sn }} · </span> }
                        from {{ s.source_ip || 'unknown ip' }} · last {{ dateTime(s.last_seen) }}
                      </p>
                    </div>
                    @if (s.status === 'unclaimed') {
                      <button class="btn btn-xs btn-ghost shrink-0" (click)="prefillClaim(s)">Claim</button>
                    } @else {
                      <span class="badge badge-ghost badge-xs shrink-0">{{ s.status }}</span>
                    }
                  </div>
                }
              </div>
            }
          }
        </section>

        <!-- Detail panel: full-screen replacement on mobile, sticky second
             column on desktop. -->
        <section [class.hidden]="!mobileDetail()" class="lg:block lg:sticky lg:top-4">
          @if (selected(); as m) {
            <!-- Back affordance — mobile only (desktop sees both columns). -->
            <button class="btn btn-ghost btn-sm mb-3 lg:hidden" (click)="mobileDetail.set(false)">
              <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                <path stroke-linecap="round" stroke-linejoin="round" d="M15 19l-7-7 7-7"/>
              </svg>
              All meters
            </button>
            <h2 class="section-label mb-3 hidden lg:block">Meter detail</h2>
            <div class="surface px-5 py-4 flex flex-col gap-4">
              <div class="min-w-0">
                <div class="flex items-center gap-2">
                  <p class="text-sm font-semibold truncate">{{ m.name || m.imei }}</p>
                  <span class="badge badge-xs shrink-0"
                    [class]="m.valve_state === 'open' ? 'badge-success' : m.valve_state === 'closed' ? 'badge-error' : 'badge-ghost'">valve {{ m.valve_state || 'unknown' }}</span>
                </div>
                <p class="text-[11px] text-base-content/50 mt-0.5">
                  IMEI <span class="font-mono">{{ m.imei }}</span>
                  @if (m.sn) { <span> · SN {{ m.sn }}</span> }
                  @if (unitCode(m)) { <span> · {{ unitCode(m) }}</span> }
                </p>
                <p class="text-[11px] text-base-content/50 mt-1">
                  Reading {{ litres(m.last_reading_ml) }}{{ m.last_reading_at ? ' · ' + dateTime(m.last_reading_at) : '' }}
                </p>
                <p class="text-[11px] mt-0.5" [class]="stale(m) ? 'text-warning' : 'text-base-content/50'">
                  Last contact {{ m.last_uplink_at ? dateTime(m.last_uplink_at) : 'never' }}{{ stale(m) ? ' — over 48h ago' : '' }}
                </p>
              </div>

              <!-- Valve control: typed confirmation. The button stays disabled
                   until the input matches the action, in capitals. -->
              @if (m.valve_capable) {
                <div class="rounded-xl border border-base-300/40 bg-base-200/40 p-4 flex flex-col gap-2.5">
                  <p class="text-xs font-semibold">Valve control</p>
                  <p class="text-[11px] text-base-content/50">
                    Valve commands are queued and applied the next time the meter contacts the server — this can take up to 24 hours. Type
                    <span class="font-mono font-semibold">{{ valveAction().toUpperCase() }}</span> to confirm.
                  </p>
                  <div class="flex flex-wrap items-center gap-2">
                    <div class="inline-flex w-fit rounded-lg bg-base-200 p-0.5">
                      <button class="btn btn-sm btn-ghost rounded-md normal-case" [class.bg-base-100]="valveAction() === 'open'" [class.shadow-sm]="valveAction() === 'open'" (click)="valveAction.set('open')">Open</button>
                      <button class="btn btn-sm btn-ghost rounded-md normal-case" [class.bg-base-100]="valveAction() === 'close'" [class.shadow-sm]="valveAction() === 'close'" (click)="valveAction.set('close')">Close</button>
                    </div>
                    <input class="input input-sm input-bordered w-32 font-mono uppercase" placeholder="{{ valveAction().toUpperCase() }}"
                           [value]="valveConfirm()" (input)="valveConfirm.set($any($event.target).value)" />
                    <button class="btn btn-sm" [class]="valveAction() === 'close' ? 'btn-error' : 'btn-primary'"
                            [disabled]="valveConfirm().trim().toUpperCase() !== valveAction().toUpperCase() || valveBusy()"
                            (click)="sendValve()">
                      @if (valveBusy()) { <span class="loading loading-spinner loading-xs"></span> }
                      Queue {{ valveAction() }}
                    </button>
                  </div>
                </div>
              } @else {
                <p class="text-[11px] text-base-content/40">This meter has no controllable valve.</p>
              }

              <!-- Command audit: loading, error and empty are distinct states,
                   all cleared on meter switch. -->
              <div>
                <p class="text-xs font-semibold mb-2">Recent commands</p>
                @if (commandsLoading()) {
                  <div class="flex items-center gap-2 py-3 text-base-content/40">
                    <span class="loading loading-spinner loading-sm"></span>
                    <span class="text-[11px]">Loading commands…</span>
                  </div>
                } @else if (commandsError(); as ce) {
                  <div class="flex items-center gap-2 py-2">
                    <p class="text-[11px] text-error flex-1">{{ ce }}</p>
                    <button class="btn btn-xs btn-ghost" (click)="loadCommands(m.id)">Retry</button>
                  </div>
                } @else if (commands().length === 0) {
                  <p class="text-[11px] text-base-content/40">No commands queued yet.</p>
                } @else {
                  <div class="divide-y divide-base-300/20">
                    @for (c of commands(); track c.id) {
                      <div class="py-2">
                        <p class="text-sm">
                          <span class="font-medium">{{ c.type.replaceAll('_', ' ') }}</span>
                          <span class="badge badge-xs ml-1.5"
                            [class]="c.status === 'acked' ? 'badge-success' : c.status === 'failed' || c.status === 'expired' ? 'badge-error' : 'badge-warning'">{{ c.status }}</span>
                        </p>
                        @if (c.status === 'queued' || c.status === 'sent') {
                          <p class="text-[11px] text-warning mt-0.5">{{ pendingCopy }}</p>
                        }
                        @if (c.error) { <p class="text-[11px] text-error mt-0.5">{{ c.error }}</p> }
                        <p class="text-[11px] text-base-content/40 mt-0.5">
                          queued {{ dateTime(c.created) }}
                          @if (c.acked_at) { <span> · acked {{ dateTime(c.acked_at) }}</span> }
                        </p>
                      </div>
                    }
                  </div>
                }
              </div>
            </div>
          } @else {
            <h2 class="section-label mb-3 hidden lg:block">Meter detail</h2>
            <app-billing-empty-state title="No meter selected" hint="Select a meter to see its valve control and command history." />
          }
        </section>
      </div>
    }
  `,
})
export class BillingMetersComponent {
  protected shell = inject(BillingShellComponent);
  private billing = inject(BillingService);

  protected readonly pendingCopy = PENDING_COPY;
  protected litres = formatLitres;
  protected dateTime = fmtDateTime;

  protected loading = signal(true);
  protected pageError = signal('');
  protected status = signal<{ ok: boolean; text: string } | null>(null);
  protected meters = signal<MeterDevice[]>([]);
  protected units = signal<BillingUnit[]>([]);
  protected sightings = signal<MeterSighting[]>([]);
  /** Meter ids with an unacknowledged downlink (queued/sent), for badges. */
  protected pendingMeters = signal<Set<string>>(new Set());

  protected selected = signal<MeterDevice | null>(null);
  /** Mobile-only: the detail view replaces the list when true. */
  protected mobileDetail = signal(false);
  protected commands = signal<MeterCommand[]>([]);
  protected commandsLoading = signal(false);
  protected commandsError = signal('');

  protected valveAction = signal<'open' | 'close'>('close');
  protected valveConfirm = signal('');
  protected valveBusy = signal(false);

  protected valveFilter = signal<ValveFilter>('all');
  protected readonly filters: { key: ValveFilter; label: string }[] = [
    { key: 'all', label: 'All' },
    { key: 'open', label: 'Open' },
    { key: 'closed', label: 'Closed' },
    { key: 'unknown', label: 'Unknown' },
    { key: 'pending', label: 'Pending' },
  ];

  protected claimImei = signal('');
  protected claimName = signal('');
  protected claimUnit = signal('');
  protected claimBusy = signal(false);

  protected visibleMeters = computed(() => {
    const f = this.valveFilter();
    const all = this.meters();
    if (f === 'all') return all;
    if (f === 'pending') return all.filter((m) => this.pendingMeters().has(m.id));
    return all.filter((m) => (m.valve_state || 'unknown') === f);
  });

  constructor() {
    void this.load();
  }

  protected unitCode(m: MeterDevice): string {
    return m.expand?.unit?.code ?? '';
  }

  protected filterCount(f: ValveFilter): number {
    if (f === 'all') return this.meters().length;
    if (f === 'pending') return this.pendingMeters().size;
    return this.meters().filter((m) => (m.valve_state || 'unknown') === f).length;
  }

  /** No uplink in >48h (or ever) — the shell's attention banner uses the same rule. */
  protected stale(m: MeterDevice): boolean {
    const t = m.last_uplink_at ? Date.parse(m.last_uplink_at) : 0;
    return !t || Date.now() - t > 48 * 3_600_000;
  }

  protected select(m: MeterDevice): void {
    this.selected.set(m);
    this.valveConfirm.set('');
    this.mobileDetail.set(true);
    void this.loadCommands(m.id);
  }

  protected reload(): void {
    this.loading.set(true);
    this.pageError.set('');
    void this.load();
  }

  private async load(): Promise<void> {
    const siteId = this.shell.siteId();
    try {
      const [meters, units, pending] = await Promise.all([
        this.billing.listMeters(siteId),
        this.billing.listUnits(siteId),
        this.billing.listPendingValveCommands(siteId),
      ]);
      this.meters.set(meters);
      this.units.set(units);
      this.pendingMeters.set(new Set(pending.map((c) => c.meter)));
      if (this.shell.isAdmin()) {
        try { this.sightings.set(await this.billing.listSightings()); } catch { /* admin-only */ }
      }
      // Pre-select the first meter for the desktop detail column; on mobile
      // the list stays on top (mobileDetail starts false).
      if (meters.length > 0 && !this.selected()) {
        this.selected.set(meters[0]!);
        void this.loadCommands(meters[0]!.id);
      }
    } catch (e) {
      this.pageError.set(pbMessage(e));
    } finally {
      this.loading.set(false);
    }
  }

  protected async loadCommands(meterId: string): Promise<void> {
    this.commands.set([]);
    this.commandsError.set('');
    this.commandsLoading.set(true);
    try {
      this.commands.set(await this.billing.meterCommands(meterId));
    } catch (e) {
      this.commandsError.set(pbMessage(e));
    } finally {
      this.commandsLoading.set(false);
    }
  }

  protected async sendValve(): Promise<void> {
    const m = this.selected();
    if (!m || this.valveBusy()) return;
    this.valveBusy.set(true);
    this.status.set(null);
    try {
      const r = await this.billing.meterValve(m.id, this.valveAction(), this.valveConfirm().trim().toUpperCase());
      this.status.set({ ok: true, text: `Valve ${this.valveAction()} command ${r.status} — ${PENDING_COPY}.` });
      this.valveConfirm.set('');
      this.pendingMeters.update((s) => new Set(s).add(m.id));
      await this.loadCommands(m.id);
    } catch (e) {
      this.status.set({ ok: false, text: pbMessage(e) });
    } finally {
      this.valveBusy.set(false);
    }
  }

  /** Sightings "Claim" shortcut: prefill the form with the sighting's identity. */
  protected prefillClaim(s: MeterSighting): void {
    this.claimImei.set(s.imei);
    if (s.sn) this.claimName.set(s.sn);
  }

  protected async claim(): Promise<void> {
    const imei = this.claimImei().trim();
    if (!imei || this.claimBusy()) return;
    this.claimBusy.set(true);
    this.status.set(null);
    try {
      const meter = await this.billing.claimMeter(this.shell.siteId(), imei, this.claimName().trim(), this.claimUnit());
      this.status.set({ ok: true, text: `Meter ${meter.imei} claimed.` });
      this.claimImei.set('');
      this.claimName.set('');
      this.claimUnit.set('');
      // Refresh list + sightings (the sighting flips to claimed server-side).
      const siteId = this.shell.siteId();
      this.meters.set(await this.billing.listMeters(siteId));
      if (this.shell.isAdmin()) {
        try { this.sightings.set(await this.billing.listSightings()); } catch { /* admin-only */ }
      }
      const claimed = this.meters().find((m) => m.id === meter.id);
      if (claimed) this.select(claimed);
    } catch (e) {
      this.status.set({ ok: false, text: pbMessage(e) });
    } finally {
      this.claimBusy.set(false);
    }
  }
}
