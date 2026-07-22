import { Component, computed, inject, signal } from '@angular/core';
import { ConfirmService } from '../../core/services/confirm.service';
import { BillingService, type BillingUnit, type Occupancy, type TenantAccount } from './billing.service';
import { BillingShellComponent } from './billing-shell.component';
import { fmtDate } from './billing-format';

/** Draft for the unit / tenant modals (id set when editing). */
interface UnitDraft { id?: string; code: string; name: string; status: string }
interface TenantDraft { id?: string; account_number: string; name: string; phone: string; email: string; status: string; notes: string }

/**
 * Tenants & units: CRUD-lite for the billing master data — billable units,
 * tenant accounts, and the occupancies that bind a tenant to a unit over time
 * (invoice generation resolves WHO pays from these rows). Deletes are
 * admin-only (collection rules) and hidden for owners.
 */
@Component({
  selector: 'app-billing-tenants',
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
        <!-- Units -->
        <section>
          <div class="flex items-center gap-2 mb-3">
            <h2 class="section-label">Units</h2>
            <span class="grow"></span>
            <button class="btn btn-xs btn-primary" (click)="openUnit()">+ Add unit</button>
          </div>
          @if (units().length === 0) {
            <div class="rounded-2xl border border-dashed border-base-300/50 py-8 text-center">
              <p class="text-sm text-base-content/50">No units yet — add the billable units (plots, rooms, stands) here.</p>
            </div>
          } @else {
            <div class="surface divide-y divide-base-300/20">
              @for (u of units(); track u.id) {
                <div class="flex items-center gap-3 px-5 py-2.5">
                  <div class="flex-1 min-w-0">
                    <p class="text-sm font-medium truncate">{{ u.code }}@if (u.name) { <span class="font-normal text-base-content/60"> — {{ u.name }}</span> }</p>
                  </div>
                  <span class="badge badge-xs shrink-0" [class]="u.status === 'active' ? 'badge-success' : u.status === 'vacant' ? 'badge-warning' : 'badge-ghost'">{{ u.status || 'active' }}</span>
                  <button class="btn btn-xs btn-ghost shrink-0" (click)="openUnit(u)">Edit</button>
                  @if (shell.isAdmin()) {
                    <button class="btn btn-xs btn-ghost text-error shrink-0" (click)="removeUnit(u)">Delete</button>
                  }
                </div>
              }
            </div>
          }

          <!-- Tenant accounts -->
          <div class="flex items-center gap-2 mb-3 mt-6">
            <h2 class="section-label">Tenant accounts</h2>
            <span class="grow"></span>
            <button class="btn btn-xs btn-primary" (click)="openTenant()">+ Add account</button>
          </div>
          @if (tenants().length === 0) {
            <div class="rounded-2xl border border-dashed border-base-300/50 py-8 text-center">
              <p class="text-sm text-base-content/50">No tenant accounts yet.</p>
            </div>
          } @else {
            <div class="surface divide-y divide-base-300/20">
              @for (t of tenants(); track t.id) {
                <div class="flex items-center gap-3 px-5 py-2.5">
                  <div class="flex-1 min-w-0">
                    <p class="text-sm font-medium truncate">{{ t.name }}</p>
                    <p class="text-[11px] text-base-content/50 truncate">
                      {{ t.account_number }}
                      @if (t.phone) { <span> · {{ t.phone }}</span> }
                      @if (t.email) { <span> · {{ t.email }}</span> }
                    </p>
                  </div>
                  @if (t.status === 'inactive') { <span class="badge badge-ghost badge-xs shrink-0">inactive</span> }
                  <button class="btn btn-xs btn-ghost shrink-0" (click)="openTenant(t)">Edit</button>
                  @if (shell.isAdmin()) {
                    <button class="btn btn-xs btn-ghost text-error shrink-0" (click)="removeTenant(t)">Delete</button>
                  }
                </div>
              }
            </div>
          }
        </section>

        <!-- Occupancies -->
        <section>
          <h2 class="section-label mb-3">Occupancies</h2>
          <p class="text-[11px] text-base-content/50 -mt-2 mb-3">Who is liable for a unit, from when. Invoices are charged from these rows.</p>

          <!-- Assign form -->
          <div class="surface px-5 py-4 flex flex-col gap-3 mb-4">
            <p class="text-xs font-semibold">Assign tenant to unit</p>
            <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <label class="flex flex-col gap-1">
                <span class="text-[11px] font-medium text-base-content/50">Unit</span>
                <select class="select select-sm select-bordered" [value]="assignUnit()" (change)="assignUnit.set($any($event.target).value)">
                  <option value="" disabled>Select unit…</option>
                  @for (u of assignableUnits(); track u.id) { <option [value]="u.id">{{ u.code }}{{ u.name ? ' — ' + u.name : '' }}</option> }
                </select>
              </label>
              <label class="flex flex-col gap-1">
                <span class="text-[11px] font-medium text-base-content/50">Tenant account</span>
                <select class="select select-sm select-bordered" [value]="assignTenant()" (change)="assignTenant.set($any($event.target).value)">
                  <option value="" disabled>Select account…</option>
                  @for (t of activeTenants(); track t.id) { <option [value]="t.id">{{ t.name }} ({{ t.account_number }})</option> }
                </select>
              </label>
              <label class="flex flex-col gap-1">
                <span class="text-[11px] font-medium text-base-content/50">Liable from</span>
                <input type="date" class="input input-sm input-bordered" [value]="assignFrom()" (input)="assignFrom.set($any($event.target).value)" />
              </label>
              <label class="flex flex-col gap-1">
                <span class="text-[11px] font-medium text-base-content/50">Move-in reading (ml, optional)</span>
                <input type="number" min="0" class="input input-sm input-bordered" placeholder="e.g. 12500000"
                       [value]="assignReading()" (input)="assignReading.set($any($event.target).value)" />
              </label>
            </div>
            <div>
              <button class="btn btn-sm btn-primary" [disabled]="!assignUnit() || !assignTenant() || !assignFrom() || assignBusy()" (click)="assign()">
                @if (assignBusy()) { <span class="loading loading-spinner loading-xs"></span> }
                Assign
              </button>
            </div>
          </div>

          @if (occupancies().length === 0) {
            <div class="rounded-2xl border border-dashed border-base-300/50 py-8 text-center">
              <p class="text-sm text-base-content/50">No occupancies yet.</p>
            </div>
          } @else {
            <div class="surface divide-y divide-base-300/20">
              @for (o of occupancies(); track o.id) {
                <div class="flex items-center gap-3 px-5 py-2.5">
                  <div class="flex-1 min-w-0">
                    <p class="text-sm font-medium truncate">{{ unitLabel(o.unit) }} — {{ tenantLabel(o.tenant_account) }}</p>
                    <p class="text-[11px] text-base-content/50">
                      from {{ date(o.liable_from) || '—' }}
                      @if (o.liable_until) { <span> until {{ date(o.liable_until) }}</span> }
                      @else { <span> · ongoing</span> }
                    </p>
                  </div>
                  @if (o.status === 'ended') {
                    <span class="badge badge-ghost badge-xs shrink-0">ended</span>
                  } @else {
                    <span class="badge badge-success badge-xs shrink-0">active</span>
                    <button class="btn btn-xs btn-ghost text-error shrink-0" (click)="endOccupancy(o)">End</button>
                  }
                </div>
              }
            </div>
          }
        </section>
      </div>
    }

    <!-- Unit modal -->
    @if (unitDraft(); as d) {
      <dialog class="modal modal-open" style="position: fixed;">
        <div class="modal-box max-w-sm">
          <h3 class="font-bold text-lg mb-4">{{ d.id ? 'Edit unit' : 'New unit' }}</h3>
          <label class="flex flex-col mb-3">
            <span class="label-text mb-1">Code</span>
            <input class="input input-bordered w-full" placeholder="e.g. A-12" [value]="d.code" (input)="d.code = $any($event.target).value" />
          </label>
          <label class="flex flex-col mb-3">
            <span class="label-text mb-1">Name</span>
            <input class="input input-bordered w-full" placeholder="e.g. Block A, room 12" [value]="d.name" (input)="d.name = $any($event.target).value" />
          </label>
          <label class="flex flex-col">
            <span class="label-text mb-1">Status</span>
            <select class="select select-bordered w-full" [value]="d.status" (change)="d.status = $any($event.target).value">
              <option value="active">active</option>
              <option value="vacant">vacant</option>
              <option value="archived">archived</option>
            </select>
          </label>
          <div class="modal-action">
            <button class="btn btn-ghost" (click)="unitDraft.set(null)" [disabled]="busy()">Cancel</button>
            <button class="btn btn-primary" [disabled]="!d.code.trim() || busy()" (click)="saveUnit()">
              @if (busy()) { <span class="loading loading-spinner loading-xs"></span> }
              Save
            </button>
          </div>
        </div>
        <div class="modal-backdrop" (click)="unitDraft.set(null)"></div>
      </dialog>
    }

    <!-- Tenant modal -->
    @if (tenantDraft(); as d) {
      <dialog class="modal modal-open" style="position: fixed;">
        <div class="modal-box max-w-sm">
          <h3 class="font-bold text-lg mb-4">{{ d.id ? 'Edit tenant account' : 'New tenant account' }}</h3>
          <label class="flex flex-col mb-3">
            <span class="label-text mb-1">Account number</span>
            <input class="input input-bordered w-full" placeholder="e.g. T-0012" [value]="d.account_number" (input)="d.account_number = $any($event.target).value" />
          </label>
          <label class="flex flex-col mb-3">
            <span class="label-text mb-1">Name</span>
            <input class="input input-bordered w-full" placeholder="e.g. Jane Mwangi" [value]="d.name" (input)="d.name = $any($event.target).value" />
          </label>
          <div class="grid grid-cols-2 gap-3 mb-3">
            <label class="flex flex-col">
              <span class="label-text mb-1">Phone</span>
              <input class="input input-bordered w-full" placeholder="+2547…" [value]="d.phone" (input)="d.phone = $any($event.target).value" />
            </label>
            <label class="flex flex-col">
              <span class="label-text mb-1">Email</span>
              <input type="email" class="input input-bordered w-full" [value]="d.email" (input)="d.email = $any($event.target).value" />
            </label>
          </div>
          @if (d.id) {
            <label class="flex flex-col mb-3">
              <span class="label-text mb-1">Status</span>
              <select class="select select-bordered w-full" [value]="d.status" (change)="d.status = $any($event.target).value">
                <option value="active">active</option>
                <option value="inactive">inactive</option>
              </select>
            </label>
          }
          <label class="flex flex-col">
            <span class="label-text mb-1">Notes</span>
            <textarea class="textarea textarea-bordered w-full" rows="2" [value]="d.notes" (input)="d.notes = $any($event.target).value"></textarea>
          </label>
          <div class="modal-action">
            <button class="btn btn-ghost" (click)="tenantDraft.set(null)" [disabled]="busy()">Cancel</button>
            <button class="btn btn-primary" [disabled]="!d.account_number.trim() || !d.name.trim() || busy()" (click)="saveTenant()">
              @if (busy()) { <span class="loading loading-spinner loading-xs"></span> }
              Save
            </button>
          </div>
        </div>
        <div class="modal-backdrop" (click)="tenantDraft.set(null)"></div>
      </dialog>
    }
  `,
})
export class BillingTenantsComponent {
  protected shell = inject(BillingShellComponent);
  private billing = inject(BillingService);
  private confirm = inject(ConfirmService);

  protected date = fmtDate;
  protected loading = signal(true);
  protected busy = signal(false);
  protected status = signal<{ ok: boolean; text: string } | null>(null);

  protected units = signal<BillingUnit[]>([]);
  protected tenants = signal<TenantAccount[]>([]);
  protected occupancies = signal<Occupancy[]>([]);

  protected unitDraft = signal<UnitDraft | null>(null);
  protected tenantDraft = signal<TenantDraft | null>(null);

  protected assignUnit = signal('');
  protected assignTenant = signal('');
  protected assignFrom = signal(new Date().toISOString().slice(0, 10));
  protected assignReading = signal('');
  protected assignBusy = signal(false);

  /** Units without an active occupancy, plus the ones already picked. */
  protected assignableUnits = computed(() => {
    const taken = new Set(this.occupancies().filter((o) => o.status !== 'ended').map((o) => o.unit));
    return this.units().filter((u) => u.status !== 'archived' && !taken.has(u.id));
  });
  protected activeTenants = computed(() => this.tenants().filter((t) => t.status !== 'inactive'));

  private unitMap = computed(() => new Map(this.units().map((u) => [u.id, u])));
  private tenantMap = computed(() => new Map(this.tenants().map((t) => [t.id, t])));

  protected unitLabel(id: string): string {
    const u = this.unitMap().get(id);
    return u ? u.code : id;
  }
  protected tenantLabel(id: string): string {
    return this.tenantMap().get(id)?.name ?? id;
  }

  constructor() {
    void this.load();
  }

  private async load(): Promise<void> {
    const siteId = this.shell.siteId();
    try {
      const [units, tenants, occupancies] = await Promise.all([
        this.billing.listUnits(siteId),
        this.billing.listTenants(siteId),
        this.billing.listOccupancies(siteId),
      ]);
      this.units.set(units);
      this.tenants.set(tenants);
      this.occupancies.set(occupancies);
    } catch (e) {
      this.status.set({ ok: false, text: e instanceof Error ? e.message : String(e) });
    } finally {
      this.loading.set(false);
    }
  }

  private async refresh(): Promise<void> {
    const siteId = this.shell.siteId();
    const [units, tenants, occupancies] = await Promise.all([
      this.billing.listUnits(siteId),
      this.billing.listTenants(siteId),
      this.billing.listOccupancies(siteId),
    ]);
    this.units.set(units);
    this.tenants.set(tenants);
    this.occupancies.set(occupancies);
  }

  // --- Units ------------------------------------------------------------------
  protected openUnit(u?: BillingUnit): void {
    this.unitDraft.set(u ? { id: u.id, code: u.code, name: u.name, status: u.status || 'active' } : { code: '', name: '', status: 'active' });
  }

  protected async saveUnit(): Promise<void> {
    const d = this.unitDraft();
    if (!d || this.busy()) return;
    this.busy.set(true);
    this.status.set(null);
    try {
      const row = { code: d.code.trim(), name: d.name.trim(), status: d.status };
      if (d.id) await this.billing.updateUnit(d.id, row);
      else await this.billing.createUnit(this.shell.siteId(), row);
      this.unitDraft.set(null);
      this.status.set({ ok: true, text: 'Unit saved.' });
      await this.refresh();
    } catch (e) {
      this.status.set({ ok: false, text: e instanceof Error ? e.message : String(e) });
    } finally {
      this.busy.set(false);
    }
  }

  protected async removeUnit(u: BillingUnit): Promise<void> {
    const ok = await this.confirm.confirm({
      title: `Delete unit ${u.code}?`,
      message: 'This removes the unit. Units with occupancies or meters may fail to delete.',
      confirmLabel: 'Delete',
      variant: 'error',
    });
    if (!ok) return;
    try {
      await this.billing.deleteUnit(u.id);
      this.status.set({ ok: true, text: `Unit ${u.code} deleted.` });
      await this.refresh();
    } catch (e) {
      this.status.set({ ok: false, text: e instanceof Error ? e.message : String(e) });
    }
  }

  // --- Tenants ----------------------------------------------------------------
  protected openTenant(t?: TenantAccount): void {
    this.tenantDraft.set(
      t
        ? { id: t.id, account_number: t.account_number, name: t.name, phone: t.phone, email: t.email, status: t.status || 'active', notes: t.notes }
        : { account_number: '', name: '', phone: '', email: '', status: 'active', notes: '' },
    );
  }

  protected async saveTenant(): Promise<void> {
    const d = this.tenantDraft();
    if (!d || this.busy()) return;
    this.busy.set(true);
    this.status.set(null);
    try {
      if (d.id) {
        await this.billing.updateTenant(d.id, {
          account_number: d.account_number.trim(), name: d.name.trim(),
          phone: d.phone.trim(), email: d.email.trim(), status: d.status, notes: d.notes,
        });
      } else {
        await this.billing.createTenant(this.shell.siteId(), {
          account_number: d.account_number.trim(), name: d.name.trim(),
          phone: d.phone.trim(), email: d.email.trim(), notes: d.notes,
        });
      }
      this.tenantDraft.set(null);
      this.status.set({ ok: true, text: 'Tenant account saved.' });
      await this.refresh();
    } catch (e) {
      this.status.set({ ok: false, text: e instanceof Error ? e.message : String(e) });
    } finally {
      this.busy.set(false);
    }
  }

  protected async removeTenant(t: TenantAccount): Promise<void> {
    const ok = await this.confirm.confirm({
      title: `Delete ${t.name}?`,
      message: 'This removes the tenant account. Accounts with invoices or occupancies may fail to delete.',
      confirmLabel: 'Delete',
      variant: 'error',
    });
    if (!ok) return;
    try {
      await this.billing.deleteTenant(t.id);
      this.status.set({ ok: true, text: `${t.name} deleted.` });
      await this.refresh();
    } catch (e) {
      this.status.set({ ok: false, text: e instanceof Error ? e.message : String(e) });
    }
  }

  // --- Occupancies ------------------------------------------------------------
  protected async assign(): Promise<void> {
    if (this.assignBusy()) return;
    this.assignBusy.set(true);
    this.status.set(null);
    try {
      const reading = parseInt(this.assignReading(), 10);
      await this.billing.createOccupancy(this.shell.siteId(), {
        unit: this.assignUnit(),
        tenant_account: this.assignTenant(),
        liable_from: new Date(this.assignFrom() + 'T00:00:00Z').toISOString(),
        ...(Number.isFinite(reading) ? { move_in_reading_ml: reading } : {}),
      });
      this.status.set({ ok: true, text: 'Occupancy assigned.' });
      this.assignUnit.set('');
      this.assignTenant.set('');
      this.assignReading.set('');
      await this.refresh();
    } catch (e) {
      this.status.set({ ok: false, text: e instanceof Error ? e.message : String(e) });
    } finally {
      this.assignBusy.set(false);
    }
  }

  protected async endOccupancy(o: Occupancy): Promise<void> {
    const ok = await this.confirm.confirm({
      title: 'End occupancy?',
      message: `This ends ${this.tenantLabel(o.tenant_account)}'s liability for ${this.unitLabel(o.unit)} from now. Future invoices will no longer charge them for this unit.`,
      confirmLabel: 'End occupancy',
      variant: 'warning',
    });
    if (!ok) return;
    try {
      await this.billing.endOccupancy(o.id);
      this.status.set({ ok: true, text: 'Occupancy ended.' });
      await this.refresh();
    } catch (e) {
      this.status.set({ ok: false, text: e instanceof Error ? e.message : String(e) });
    }
  }
}
