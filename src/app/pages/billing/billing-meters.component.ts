import { Component, inject, signal } from '@angular/core';
import { BillingService, type BillingUnit, type MeterCommand, type MeterDevice, type MeterSighting } from './billing.service';
import { BillingShellComponent } from './billing-shell.component';
import { formatLitres, fmtDateTime } from './billing-format';

/** Copy shown next to any not-yet-acknowledged command. Never imply instant action. */
const PENDING_COPY = 'pending — applies at next meter contact (up to 24h)';

/**
 * Billing meters: the site's claimed meter list, a per-meter detail panel
 * (typed-confirm valve control + the downlink command audit), the claim form,
 * and — for admins — the unclaimed-device sightings table with a claim shortcut.
 *
 * Valve actuation is a queued downlink, NOT a live switch: every queued/sent
 * command carries the pending copy, and the action requires typing OPEN/CLOSE
 * before its button enables (the backend enforces the same match).
 */
@Component({
  selector: 'app-billing-meters',
  standalone: true,
  host: { class: 'block' },
  template: `
    @if (loading()) {
      <div class="flex items-center justify-center py-24"><span class="loading loading-spinner loading-lg"></span></div>
    } @else {
      @if (status(); as st) {
        <div role="alert" class="alert text-sm py-2 mb-4" [class]="st.ok ? 'alert-success' : 'alert-error'">
          <span>{{ st.text }}</span>
          <button class="btn btn-ghost btn-xs" (click)="status.set(null)">Dismiss</button>
        </div>
      }

      <div class="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
        <!-- Meter list -->
        <section>
          <h2 class="section-label mb-3">Meters</h2>
          @if (meters().length === 0) {
            <div class="rounded-2xl border border-dashed border-base-300/50 py-10 text-center">
              <p class="text-sm font-medium">No meters claimed</p>
              <p class="text-sm text-base-content/50 mt-1">Claim a meter by IMEI below to start tracking it.</p>
            </div>
          } @else {
            <div class="surface divide-y divide-base-300/20">
              @for (m of meters(); track m.id) {
                <button type="button" class="w-full text-left flex items-center gap-3 px-5 py-3 hover:bg-base-200/30 transition-colors"
                        [class.bg-base-200/40]="selected()?.id === m.id" (click)="select(m)">
                  <span class="w-2 h-2 rounded-full shrink-0"
                        [title]="'Valve ' + (m.valve_state || 'unknown')"
                        [class]="m.valve_state === 'open' ? 'bg-success' : m.valve_state === 'closed' ? 'bg-error' : 'bg-base-content/30'"></span>
                  <div class="flex-1 min-w-0">
                    <p class="text-sm font-medium truncate">{{ m.name || m.imei }}</p>
                    <p class="text-[11px] text-base-content/50 truncate">
                      {{ m.imei }}
                      @if (unitCode(m)) { <span> · {{ unitCode(m) }}</span> }
                      <span> · valve {{ m.valve_state || 'unknown' }}</span>
                    </p>
                  </div>
                  <div class="text-right shrink-0">
                    <p class="text-sm tabular-nums">{{ litres(m.last_reading_ml) }}</p>
                    <p class="text-[11px] text-base-content/40">{{ m.last_uplink_at ? dateTime(m.last_uplink_at) : 'never reported' }}</p>
                  </div>
                </button>
              }
            </div>
          }

          <!-- Claim form -->
          <h2 class="section-label mb-3 mt-6">Claim a meter</h2>
          <div class="surface px-5 py-4 flex flex-col gap-3">
            <label class="flex flex-col gap-1">
              <span class="text-[11px] font-medium text-base-content/50">IMEI</span>
              <input class="input input-sm input-bordered" placeholder="86xxxxxxxxxxxxx"
                     [value]="claimImei()" (input)="claimImei.set($any($event.target).value)" />
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
              <p class="text-sm text-base-content/40">No devices have phoned home.</p>
            } @else {
              <div class="surface divide-y divide-base-300/20">
                @for (s of sightings(); track s.id) {
                  <div class="flex items-center gap-3 px-5 py-2.5">
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

        <!-- Detail panel -->
        <section class="lg:sticky lg:top-4">
          <h2 class="section-label mb-3">Meter detail</h2>
          @if (selected(); as m) {
            <div class="surface px-5 py-4 flex flex-col gap-4">
              <div class="min-w-0">
                <p class="text-sm font-semibold truncate">{{ m.name || m.imei }}</p>
                <p class="text-[11px] text-base-content/50">
                  IMEI {{ m.imei }}
                  @if (m.sn) { <span> · SN {{ m.sn }}</span> }
                  @if (unitCode(m)) { <span> · {{ unitCode(m) }}</span> }
                </p>
                <p class="text-[11px] text-base-content/50 mt-1">
                  Reading {{ litres(m.last_reading_ml) }}
                  {{ m.last_reading_at ? ' · ' + dateTime(m.last_reading_at) : '' }}
                  · valve {{ m.valve_state || 'unknown' }}
                </p>
              </div>

              <!-- Valve control: typed confirmation. The button stays disabled until
                   the input matches the action, in capitals. -->
              @if (m.valve_capable) {
                <div class="rounded-xl ring-1 ring-base-300/40 px-4 py-3 flex flex-col gap-2">
                  <p class="text-xs font-semibold">Valve control</p>
                  <p class="text-[11px] text-base-content/50">
                    Valve commands are queued and applied the next time the meter contacts the server — this can take up to 24 hours. Type
                    <span class="font-mono font-semibold">{{ valveAction().toUpperCase() }}</span> to confirm.
                  </p>
                  <div class="flex flex-wrap items-center gap-2">
                    <div class="inline-flex w-fit rounded-lg bg-base-200 p-0.5">
                      <button class="btn btn-xs btn-ghost rounded-md normal-case" [class.bg-base-100]="valveAction() === 'open'" [class.shadow-sm]="valveAction() === 'open'" (click)="valveAction.set('open')">Open</button>
                      <button class="btn btn-xs btn-ghost rounded-md normal-case" [class.bg-base-100]="valveAction() === 'close'" [class.shadow-sm]="valveAction() === 'close'" (click)="valveAction.set('close')">Close</button>
                    </div>
                    <input class="input input-xs input-bordered w-24 font-mono uppercase" placeholder="{{ valveAction().toUpperCase() }}"
                           [value]="valveConfirm()" (input)="valveConfirm.set($any($event.target).value)" />
                    <button class="btn btn-xs" [class]="valveAction() === 'close' ? 'btn-error' : 'btn-primary'"
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

              <!-- Recent commands -->
              <div>
                <p class="text-xs font-semibold mb-2">Recent commands</p>
                @if (commands().length === 0) {
                  <p class="text-[11px] text-base-content/40">No commands queued yet.</p>
                } @else {
                  <div class="divide-y divide-base-300/20">
                    @for (c of commands(); track c.id) {
                      <div class="py-2">
                        <p class="text-sm">
                          <span class="font-medium">{{ c.type.replace('_', ' ') }}</span>
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
            <div class="rounded-2xl border border-dashed border-base-300/50 py-10 text-center">
              <p class="text-sm text-base-content/50">Select a meter to see its valve control and command history.</p>
            </div>
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
  protected status = signal<{ ok: boolean; text: string } | null>(null);
  protected meters = signal<MeterDevice[]>([]);
  protected units = signal<BillingUnit[]>([]);
  protected sightings = signal<MeterSighting[]>([]);

  protected selected = signal<MeterDevice | null>(null);
  protected commands = signal<MeterCommand[]>([]);

  protected valveAction = signal<'open' | 'close'>('close');
  protected valveConfirm = signal('');
  protected valveBusy = signal(false);

  protected claimImei = signal('');
  protected claimName = signal('');
  protected claimUnit = signal('');
  protected claimBusy = signal(false);

  constructor() {
    void this.load();
  }

  protected unitCode(m: MeterDevice): string {
    return m.expand?.unit?.code ?? '';
  }

  protected select(m: MeterDevice): void {
    this.selected.set(m);
    this.valveConfirm.set('');
    void this.loadCommands(m.id);
  }

  private async load(): Promise<void> {
    const siteId = this.shell.siteId();
    try {
      const [meters, units] = await Promise.all([
        this.billing.listMeters(siteId),
        this.billing.listUnits(siteId),
      ]);
      this.meters.set(meters);
      this.units.set(units);
      if (this.shell.isAdmin()) {
        try { this.sightings.set(await this.billing.listSightings()); } catch { /* admin-only */ }
      }
      if (meters.length > 0) this.select(meters[0]!);
    } catch (e) {
      this.status.set({ ok: false, text: e instanceof Error ? e.message : String(e) });
    } finally {
      this.loading.set(false);
    }
  }

  private async loadCommands(meterId: string): Promise<void> {
    try {
      this.commands.set(await this.billing.meterCommands(meterId));
    } catch {
      this.commands.set([]);
    }
  }

  protected async sendValve(): Promise<void> {
    const m = this.selected();
    if (!m || this.valveBusy()) return;
    this.valveBusy.set(true);
    this.status.set(null);
    try {
      const r = await this.billing.meterValve(m.id, this.valveAction());
      this.status.set({ ok: true, text: `Valve ${this.valveAction()} command ${r.status} — ${PENDING_COPY}.` });
      this.valveConfirm.set('');
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

/** PocketBase errors carry the server message under `.message` — surface it plainly. */
function pbMessage(e: unknown): string {
  const err = e as { message?: string; data?: { message?: string } };
  return err?.data?.message || err?.message || String(e);
}
