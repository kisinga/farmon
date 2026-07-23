import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ConfirmService } from '../../core/services/confirm.service';
import { BillingService, type BillingUnit, type Occupancy, type TenantAccount } from './billing.service';
import { BillingShellComponent } from './billing-shell.component';
import { BillingBannerComponent, BillingEmptyStateComponent, BillingPageErrorComponent } from './billing-ui';
import { fmtDate, formatLitres, litresToMl, pbMessage } from './billing-format';

/** Draft for the unit / tenant modals (id set when editing). */
interface UnitDraft { id?: string; code: string; name: string; status: string }
interface TenantDraft { id?: string; account_number: string; name: string; phone: string; email: string; status: string; notes: string }

/**
 * Tenants & units: CRUD-lite for the billing master data — billable units,
 * tenant accounts, and the occupancies that bind a tenant to a unit over time
 * (invoice generation resolves WHO pays from these rows). Deletes are
 * admin-only (collection rules) and hidden for owners.
 *
 * Forms are template-driven (ngModel + ngForm, the house pattern — the app
 * has no reactive-forms usage), so `required`/`min`/`email` validators engage
 * the global ng-touched.ng-invalid → input-error styling; save stays disabled
 * until the form is valid. Move-in readings are entered in LITRES (what the
 * meter face shows) and converted to ml at the boundary via litresToMl.
 */
@Component({
  selector: 'app-billing-tenants',
  standalone: true,
  imports: [FormsModule, BillingBannerComponent, BillingEmptyStateComponent, BillingPageErrorComponent],
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

      <div class="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
        <!-- Units + tenant accounts -->
        <section>
          <div class="flex items-center gap-2 mb-3">
            <h2 class="section-label">Units</h2>
            <span class="grow"></span>
            <input class="input input-xs input-bordered w-32" placeholder="Filter…"
                   [value]="unitSearch()" (input)="unitSearch.set($any($event.target).value)" />
            <button class="btn btn-xs btn-primary" (click)="openUnit()">+ Add unit</button>
          </div>
          @if (units().length === 0) {
            <app-billing-empty-state title="No units yet" hint="Add the billable units (plots, rooms, stands) here." />
          } @else if (visibleUnits().length === 0) {
            <app-billing-empty-state title="No units match this filter" />
          } @else {
            <div class="surface divide-y divide-base-300/20">
              @for (u of visibleUnits(); track u.id) {
                <div class="flex items-center gap-3 px-4 py-2.5">
                  <div class="flex-1 min-w-0">
                    <p class="text-sm font-medium truncate">{{ u.code }}@if (u.name) { <span class="font-normal text-base-content/60"> — {{ u.name }}</span> }</p>
                    <p class="text-[11px] truncate" [class]="occupantOf(u.id) ? 'text-base-content/50' : 'text-base-content/40'">
                      @if (occupantOf(u.id); as name) {
                        Occupied — {{ name }}
                      } @else {
                        Vacant
                      }
                    </p>
                  </div>
                  @if (u.status === 'archived') {
                    <span class="badge badge-ghost badge-xs shrink-0">archived</span>
                  }
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
            <input class="input input-xs input-bordered w-32" placeholder="Filter…"
                   [value]="tenantSearch()" (input)="tenantSearch.set($any($event.target).value)" />
            <button class="btn btn-xs btn-primary" (click)="openTenant()">+ Add account</button>
          </div>
          @if (tenants().length === 0) {
            <app-billing-empty-state title="No tenant accounts yet" />
          } @else if (visibleTenants().length === 0) {
            <app-billing-empty-state title="No accounts match this filter" />
          } @else {
            <div class="surface divide-y divide-base-300/20">
              @for (t of visibleTenants(); track t.id) {
                <div class="flex items-center gap-3 px-4 py-2.5">
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
          <form #assignForm="ngForm" (ngSubmit)="assign()" class="surface px-5 py-4 flex flex-col gap-3 mb-4">
            <p class="text-xs font-semibold">Assign tenant to unit</p>
            <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <label class="flex flex-col gap-1">
                <span class="text-[11px] font-medium text-base-content/50">Unit <span class="text-error">*</span></span>
                <select class="select select-sm select-bordered" name="assignUnit" required
                        [ngModel]="assignUnit()" (ngModelChange)="assignUnit.set($event)">
                  <option value="" disabled>Select unit…</option>
                  @for (u of assignableUnits(); track u.id) { <option [value]="u.id">{{ u.code }}{{ u.name ? ' — ' + u.name : '' }}</option> }
                </select>
              </label>
              <label class="flex flex-col gap-1">
                <span class="text-[11px] font-medium text-base-content/50">Tenant account <span class="text-error">*</span></span>
                <select class="select select-sm select-bordered" name="assignTenant" required
                        [ngModel]="assignTenant()" (ngModelChange)="assignTenant.set($event)">
                  <option value="" disabled>Select account…</option>
                  @for (t of activeTenants(); track t.id) { <option [value]="t.id">{{ t.name }} ({{ t.account_number }})</option> }
                </select>
              </label>
              <label class="flex flex-col gap-1">
                <span class="text-[11px] font-medium text-base-content/50">Liable from <span class="text-error">*</span></span>
                <input type="date" class="input input-sm input-bordered" name="assignFrom" required
                       [ngModel]="assignFrom()" (ngModelChange)="assignFrom.set($event)" />
              </label>
              <label class="flex flex-col gap-1">
                <span class="text-[11px] font-medium text-base-content/50">Move-in reading (L, optional)</span>
                <input type="number" min="0" step="any" class="input input-sm input-bordered" name="assignReading"
                       placeholder="e.g. 12500" #readingCtrl="ngModel"
                       [ngModel]="assignReading()" (ngModelChange)="assignReading.set($event)" />
                @if (readingCtrl.touched && readingCtrl.hasError('min')) {
                  <span class="text-error text-[11px]">Reading can't be negative.</span>
                }
              </label>
            </div>
            <div>
              <button type="submit" class="btn btn-sm btn-primary" [disabled]="assignForm.invalid || assignBusy()">
                @if (assignBusy()) { <span class="loading loading-spinner loading-xs"></span> }
                Assign
              </button>
            </div>
          </form>

          @if (occupancies().length === 0) {
            <app-billing-empty-state title="No occupancies yet" hint="Assign a tenant to a unit above to start billing them." />
          } @else {
            <div class="surface divide-y divide-base-300/20">
              @for (o of occupancies(); track o.id) {
                <div class="flex items-center gap-3 px-4 py-2.5">
                  <div class="flex-1 min-w-0">
                    <p class="text-sm font-medium truncate">{{ unitLabel(o.unit) }} — {{ tenantLabel(o.tenant_account) }}</p>
                    <p class="text-[11px] text-base-content/50">
                      from {{ date(o.liable_from) || '—' }}
                      @if (o.liable_until) { <span> until {{ date(o.liable_until) }}</span> }
                      @else { <span> · ongoing</span> }
                      @if (o.move_in_reading_ml) { <span> · move-in {{ litres(o.move_in_reading_ml) }}</span> }
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
          <form #unitForm="ngForm" (ngSubmit)="saveUnit()">
            <label class="flex flex-col mb-3">
              <span class="label-text mb-1">Code <span class="text-error">*</span></span>
              <input class="input input-bordered w-full" placeholder="e.g. A-12" name="unitCode" required
                     #unitCodeCtrl="ngModel" [(ngModel)]="d.code" />
              @if (unitCodeCtrl.touched && unitCodeCtrl.hasError('required')) {
                <span class="text-error text-[11px] mt-1">Code is required.</span>
              }
            </label>
            <label class="flex flex-col mb-3">
              <span class="label-text mb-1">Name</span>
              <input class="input input-bordered w-full" placeholder="e.g. Block A, room 12" name="unitName" [(ngModel)]="d.name" />
            </label>
            <label class="flex flex-col">
              <span class="label-text mb-1">Status</span>
              <select class="select select-bordered w-full" name="unitStatus" [(ngModel)]="d.status">
                <option value="active">active</option>
                <option value="vacant">vacant</option>
                <option value="archived">archived</option>
              </select>
            </label>
            <div class="modal-action">
              <button type="button" class="btn btn-ghost" (click)="unitDraft.set(null)" [disabled]="busy()">Cancel</button>
              <button type="submit" class="btn btn-primary" [disabled]="unitForm.invalid || busy()">
                @if (busy()) { <span class="loading loading-spinner loading-xs"></span> }
                Save
              </button>
            </div>
          </form>
        </div>
        <div class="modal-backdrop" (click)="unitDraft.set(null)"></div>
      </dialog>
    }

    <!-- Tenant modal -->
    @if (tenantDraft(); as d) {
      <dialog class="modal modal-open" style="position: fixed;">
        <div class="modal-box max-w-sm">
          <h3 class="font-bold text-lg mb-4">{{ d.id ? 'Edit tenant account' : 'New tenant account' }}</h3>
          <form #tenantForm="ngForm" (ngSubmit)="saveTenant()">
            <label class="flex flex-col mb-3">
              <span class="label-text mb-1">Account number <span class="text-error">*</span></span>
              <input class="input input-bordered w-full" placeholder="e.g. T-0012" name="accountNumber" required
                     #accountNumberCtrl="ngModel" [(ngModel)]="d.account_number" />
              @if (accountNumberCtrl.touched && accountNumberCtrl.hasError('required')) {
                <span class="text-error text-[11px] mt-1">Account number is required.</span>
              }
            </label>
            <label class="flex flex-col mb-3">
              <span class="label-text mb-1">Name <span class="text-error">*</span></span>
              <input class="input input-bordered w-full" placeholder="e.g. Jane Mwangi" name="tenantName" required
                     #tenantNameCtrl="ngModel" [(ngModel)]="d.name" />
              @if (tenantNameCtrl.touched && tenantNameCtrl.hasError('required')) {
                <span class="text-error text-[11px] mt-1">Name is required.</span>
              }
            </label>
            <div class="grid grid-cols-2 gap-3 mb-3">
              <label class="flex flex-col">
                <span class="label-text mb-1">Phone</span>
                <input class="input input-bordered w-full" placeholder="+2547…" name="tenantPhone" [(ngModel)]="d.phone" />
              </label>
              <label class="flex flex-col">
                <span class="label-text mb-1">Email</span>
                <input type="email" class="input input-bordered w-full" name="tenantEmail" email
                       #tenantEmailCtrl="ngModel" [(ngModel)]="d.email" />
                @if (tenantEmailCtrl.touched && tenantEmailCtrl.hasError('email')) {
                  <span class="text-error text-[11px] mt-1">Enter a valid email address.</span>
                }
              </label>
            </div>
            @if (d.id) {
              <label class="flex flex-col mb-3">
                <span class="label-text mb-1">Status</span>
                <select class="select select-bordered w-full" name="tenantStatus" [(ngModel)]="d.status">
                  <option value="active">active</option>
                  <option value="inactive">inactive</option>
                </select>
              </label>
            }
            <label class="flex flex-col">
              <span class="label-text mb-1">Notes</span>
              <textarea class="textarea textarea-bordered w-full" rows="2" name="tenantNotes" [(ngModel)]="d.notes"></textarea>
            </label>
            <div class="modal-action">
              <button type="button" class="btn btn-ghost" (click)="tenantDraft.set(null)" [disabled]="busy()">Cancel</button>
              <button type="submit" class="btn btn-primary" [disabled]="tenantForm.invalid || busy()">
                @if (busy()) { <span class="loading loading-spinner loading-xs"></span> }
                Save
              </button>
            </div>
          </form>
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
  protected litres = formatLitres;
  protected loading = signal(true);
  protected pageError = signal('');
  protected busy = signal(false);
  protected status = signal<{ ok: boolean; text: string } | null>(null);

  protected units = signal<BillingUnit[]>([]);
  protected tenants = signal<TenantAccount[]>([]);
  protected occupancies = signal<Occupancy[]>([]);

  protected unitSearch = signal('');
  protected tenantSearch = signal('');

  protected unitDraft = signal<UnitDraft | null>(null);
  protected tenantDraft = signal<TenantDraft | null>(null);

  protected assignUnit = signal('');
  protected assignTenant = signal('');
  protected assignFrom = signal(new Date().toISOString().slice(0, 10));
  /** Move-in reading in LITRES (null = blank); converted to ml on save. */
  protected assignReading = signal<number | null>(null);
  protected assignBusy = signal(false);

  protected visibleUnits = computed(() => {
    const q = this.unitSearch().trim().toLowerCase();
    const all = this.units();
    return q ? all.filter((u) => (u.code + ' ' + u.name).toLowerCase().includes(q)) : all;
  });
  protected visibleTenants = computed(() => {
    const q = this.tenantSearch().trim().toLowerCase();
    const all = this.tenants();
    return q
      ? all.filter((t) => (t.name + ' ' + t.account_number + ' ' + t.phone + ' ' + t.email).toLowerCase().includes(q))
      : all;
  });

  /** Non-archived units without an active occupancy. */
  protected assignableUnits = computed(() => {
    const taken = new Set(this.occupancies().filter((o) => o.status !== 'ended').map((o) => o.unit));
    return this.units().filter((u) => u.status !== 'archived' && !taken.has(u.id));
  });
  protected activeTenants = computed(() => this.tenants().filter((t) => t.status !== 'inactive'));

  /** unit id → occupying tenant name, for the inline vacant/occupied status. */
  private occupantByUnit = computed(() => {
    const m = new Map<string, string>();
    for (const o of this.occupancies()) {
      if (o.status !== 'ended') m.set(o.unit, this.tenantLabel(o.tenant_account));
    }
    return m;
  });

  private unitMap = computed(() => new Map(this.units().map((u) => [u.id, u])));
  private tenantMap = computed(() => new Map(this.tenants().map((t) => [t.id, t])));

  protected occupantOf(unitId: string): string {
    return this.occupantByUnit().get(unitId) ?? '';
  }
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

  protected reload(): void {
    this.loading.set(true);
    this.pageError.set('');
    void this.load();
  }

  private async load(): Promise<void> {
    try {
      await this.refresh();
    } catch (e) {
      this.pageError.set(pbMessage(e));
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
      this.status.set({ ok: false, text: pbMessage(e) });
    } finally {
      this.busy.set(false);
    }
  }

  protected async removeUnit(u: BillingUnit): Promise<void> {
    const ok = await this.confirm.confirm({
      title: `Delete unit ${u.code}?`,
      message: 'This permanently deletes the unit. The server refuses the delete while occupancies still reference it — end those occupancies first.',
      confirmLabel: 'Delete',
      variant: 'error',
    });
    if (!ok) return;
    try {
      await this.billing.deleteUnit(u.id);
      this.status.set({ ok: true, text: `Unit ${u.code} deleted.` });
      await this.refresh();
    } catch (e) {
      this.status.set({ ok: false, text: pbMessage(e) });
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
      this.status.set({ ok: false, text: pbMessage(e) });
    } finally {
      this.busy.set(false);
    }
  }

  protected async removeTenant(t: TenantAccount): Promise<void> {
    const ok = await this.confirm.confirm({
      title: `Delete ${t.name}?`,
      message: 'This permanently deletes the account. The server refuses the delete while occupancies or invoices still reference it.',
      confirmLabel: 'Delete',
      variant: 'error',
    });
    if (!ok) return;
    try {
      await this.billing.deleteTenant(t.id);
      this.status.set({ ok: true, text: `${t.name} deleted.` });
      await this.refresh();
    } catch (e) {
      this.status.set({ ok: false, text: pbMessage(e) });
    }
  }

  // --- Occupancies ------------------------------------------------------------
  protected async assign(): Promise<void> {
    if (this.assignBusy()) return;
    this.assignBusy.set(true);
    this.status.set(null);
    try {
      const reading = this.assignReading();
      await this.billing.createOccupancy(this.shell.siteId(), {
        unit: this.assignUnit(),
        tenant_account: this.assignTenant(),
        liable_from: new Date(this.assignFrom() + 'T00:00:00Z').toISOString(),
        ...(typeof reading === 'number' && Number.isFinite(reading) ? { move_in_reading_ml: litresToMl(reading) } : {}),
      });
      this.status.set({ ok: true, text: 'Occupancy assigned.' });
      this.assignUnit.set('');
      this.assignTenant.set('');
      this.assignReading.set(null);
      await this.refresh();
    } catch (e) {
      this.status.set({ ok: false, text: pbMessage(e) });
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
      this.status.set({ ok: false, text: pbMessage(e) });
    }
  }
}
