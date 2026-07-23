import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ConfirmService } from '../../core/services/confirm.service';
import { BillingService, type Tariff } from './billing.service';
import { BillingShellComponent } from './billing-shell.component';
import { BillingBannerComponent, BillingEmptyStateComponent, BillingPageErrorComponent } from './billing-ui';
import { formatMoney, parseMoneyToMinor, fmtDate, bpsToPercent, percentToBps, pbMessage } from './billing-format';

/** IANA zones offered in the picker — East Africa first, Nairobi the default. */
const TIMEZONES = [
  'Africa/Nairobi',
  'Africa/Dar_es_Salaam',
  'Africa/Kampala',
  'Africa/Kigali',
  'Africa/Addis_Ababa',
  'UTC',
];

/** Currencies the billing surfaces can format (formatMoney takes any ISO code). */
const CURRENCIES = ['KES', 'UGX', 'TZS', 'USD'];

/** Tariff modal draft: money fields in major units, tax in PERCENT (converted on save). */
interface TariffDraft {
  id?: string;
  name: string;
  rate_per_kl: string;
  standing_charge: string;
  minimum_charge: string;
  tax_percent: number | null;
  effective_from: string;
  effective_until: string;
  status: string;
}

/**
 * Billing settings: the one-row-per-site billing_settings record (create-if-
 * missing on save) plus tariff CRUD-lite. The auto-valve toggle arms the
 * arrears → disconnection automation, so it carries explicit warning copy.
 *
 * Tax is entered in percent (16) — nobody thinks in basis points; the bps
 * conversion happens at the form boundary via bpsToPercent/percentToBps.
 */
@Component({
  selector: 'app-billing-settings',
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
        <!-- Site billing policy -->
        <section>
          <h2 class="section-label mb-3">Billing policy</h2>
          <div class="surface px-5 py-4 flex flex-col gap-3">
            <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <label class="flex flex-col gap-1">
                <span class="text-[11px] font-medium text-base-content/50">Timezone</span>
                <select class="select select-sm select-bordered" [value]="timezone()" (change)="timezone.set($any($event.target).value)">
                  @for (tz of timezones; track tz) { <option [value]="tz">{{ tz }}</option> }
                </select>
              </label>
              <label class="flex flex-col gap-1">
                <span class="text-[11px] font-medium text-base-content/50">Currency</span>
                <select class="select select-sm select-bordered" [value]="currency()" (change)="currency.set($any($event.target).value)">
                  @for (c of currencies; track c) { <option [value]="c">{{ c }}</option> }
                </select>
              </label>
            </div>
            <div class="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <label class="flex flex-col gap-1">
                <span class="text-[11px] font-medium text-base-content/50">Due day</span>
                <input type="number" min="1" max="28" class="input input-sm input-bordered"
                       [value]="dueDay()" (input)="dueDay.set(num($event))" />
              </label>
              <label class="flex flex-col gap-1">
                <span class="text-[11px] font-medium text-base-content/50">Grace days</span>
                <input type="number" min="0" class="input input-sm input-bordered"
                       [value]="graceDays()" (input)="graceDays.set(num($event))" />
              </label>
              <label class="flex flex-col gap-1">
                <span class="text-[11px] font-medium text-base-content/50">Warn days</span>
                <input type="number" min="0" class="input input-sm input-bordered"
                       [value]="warnDays()" (input)="warnDays.set(num($event))" />
              </label>
            </div>
            <p class="text-[11px] text-base-content/40 -mt-1">
              Invoices fall due on day {{ dueDay() }} of the month, warn {{ warnDays() }} day{{ warnDays() === 1 ? '' : 's' }} after the due date, and go overdue {{ graceDays() }} day{{ graceDays() === 1 ? '' : 's' }} after that.
            </p>

            <label class="flex items-start gap-2.5 cursor-pointer select-none rounded-xl ring-1 px-4 py-3 transition-colors"
                   [class]="autoValve() ? 'ring-error/40 bg-error/5' : 'ring-base-300/40'">
              <input type="checkbox" class="toggle toggle-sm mt-0.5" [class.toggle-error]="autoValve()"
                     [checked]="autoValve()" (change)="autoValve.set($any($event.target).checked)" />
              <span>
                <span class="text-sm font-medium">Automatic valve disconnection</span>
                <span class="block text-[11px] text-base-content/60 mt-0.5">
                  When enabled, meters of accounts that stay overdue past the grace period are automatically queued a
                  <strong>close</strong> command. The valve closes at the meter's next contact — up to 24 hours later —
                  and the tenant's water is disconnected without a further manual step.
                </span>
              </span>
            </label>

            <div>
              <button class="btn btn-sm btn-primary" [disabled]="busy()" (click)="saveSettings()">
                @if (busy()) { <span class="loading loading-spinner loading-xs"></span> }
                Save policy
              </button>
            </div>
          </div>
        </section>

        <!-- Tariffs -->
        <section>
          <div class="flex items-center gap-2 mb-3">
            <h2 class="section-label">Tariffs</h2>
            <span class="grow"></span>
            <button class="btn btn-xs btn-primary" (click)="openTariff()">+ Add tariff</button>
          </div>
          @if (tariffs().length === 0) {
            <app-billing-empty-state title="No tariffs yet" hint="Invoices can't be prepared without an active tariff." />
          } @else {
            <div class="surface divide-y divide-base-300/20">
              @for (t of tariffs(); track t.id) {
                <div class="flex items-center gap-3 px-4 py-2.5">
                  <div class="flex-1 min-w-0">
                    <p class="text-sm font-medium truncate">{{ t.name }}</p>
                    <p class="text-[11px] text-base-content/50">
                      {{ money(t.rate_per_kl_minor) }}/kl
                      @if (t.standing_charge_minor) { <span> · standing {{ money(t.standing_charge_minor) }}</span> }
                      @if (t.minimum_charge_minor) { <span> · min {{ money(t.minimum_charge_minor) }}</span> }
                      @if (t.tax_bps) { <span> · tax {{ taxPercent(t.tax_bps) }}%</span> }
                    </p>
                    <p class="text-[11px] text-base-content/40">
                      from {{ date(t.effective_from) || '—' }}{{ t.effective_until ? ' until ' + date(t.effective_until) : ' · open-ended' }}
                    </p>
                  </div>
                  <span class="badge badge-xs shrink-0" [class]="t.status === 'active' ? 'badge-success' : 'badge-ghost'">{{ t.status || 'active' }}</span>
                  <button class="btn btn-xs btn-ghost shrink-0" (click)="openTariff(t)">Edit</button>
                  @if (shell.isAdmin()) {
                    <button class="btn btn-xs btn-ghost text-error shrink-0" (click)="removeTariff(t)">Delete</button>
                  }
                </div>
              }
            </div>
          }
        </section>
      </div>
    }

    <!-- Tariff modal -->
    @if (tariffDraft(); as d) {
      <dialog class="modal modal-open" style="position: fixed;">
        <div class="modal-box max-w-sm">
          <h3 class="font-bold text-lg mb-4">{{ d.id ? 'Edit tariff' : 'New tariff' }}</h3>
          <form #tariffForm="ngForm" (ngSubmit)="saveTariff()">
            <label class="flex flex-col mb-3">
              <span class="label-text mb-1">Name <span class="text-error">*</span></span>
              <input class="input input-bordered w-full" placeholder="e.g. Residential 2026" name="tariffName" required
                     #tariffNameCtrl="ngModel" [(ngModel)]="d.name" />
              @if (tariffNameCtrl.touched && tariffNameCtrl.hasError('required')) {
                <span class="text-error text-[11px] mt-1">Name is required.</span>
              }
            </label>
            <label class="flex flex-col mb-3">
              <span class="label-text mb-1">Rate per kilolitre ({{ currency() }}/kl)</span>
              <input class="input input-bordered w-full" inputmode="decimal" placeholder="e.g. 85.00" name="ratePerKl" [(ngModel)]="d.rate_per_kl" />
            </label>
            <div class="grid grid-cols-2 gap-3 mb-3">
              <label class="flex flex-col">
                <span class="label-text mb-1">Standing charge ({{ currency() }})</span>
                <input class="input input-bordered w-full" inputmode="decimal" placeholder="0.00" name="standingCharge" [(ngModel)]="d.standing_charge" />
              </label>
              <label class="flex flex-col">
                <span class="label-text mb-1">Minimum charge ({{ currency() }})</span>
                <input class="input input-bordered w-full" inputmode="decimal" placeholder="0.00" name="minimumCharge" [(ngModel)]="d.minimum_charge" />
              </label>
            </div>
            <label class="flex flex-col mb-3">
              <span class="label-text mb-1">Tax (%)</span>
              <input type="number" min="0" step="any" inputmode="decimal" class="input input-bordered w-full" placeholder="e.g. 16"
                     name="taxPercent" [(ngModel)]="d.tax_percent" />
            </label>
            <div class="grid grid-cols-2 gap-3 mb-3">
              <label class="flex flex-col">
                <span class="label-text mb-1">Effective from <span class="text-error">*</span></span>
                <input type="date" class="input input-bordered w-full" name="effectiveFrom" required [(ngModel)]="d.effective_from" />
              </label>
              <label class="flex flex-col">
                <span class="label-text mb-1">Effective until (optional)</span>
                <input type="date" class="input input-bordered w-full" name="effectiveUntil" [(ngModel)]="d.effective_until" />
              </label>
            </div>
            <label class="flex flex-col">
              <span class="label-text mb-1">Status</span>
              <select class="select select-bordered w-full" name="tariffStatus" [(ngModel)]="d.status">
                <option value="active">active</option>
                <option value="retired">retired</option>
              </select>
            </label>
            @if (tariffError()) { <p class="text-error text-xs mt-2">{{ tariffError() }}</p> }
            <div class="modal-action">
              <button type="button" class="btn btn-ghost" (click)="tariffDraft.set(null)" [disabled]="busy()">Cancel</button>
              <button type="submit" class="btn btn-primary" [disabled]="tariffForm.invalid || busy()">
                @if (busy()) { <span class="loading loading-spinner loading-xs"></span> }
                Save
              </button>
            </div>
          </form>
        </div>
        <div class="modal-backdrop" (click)="tariffDraft.set(null)"></div>
      </dialog>
    }
  `,
})
export class BillingSettingsComponent {
  protected shell = inject(BillingShellComponent);
  private billing = inject(BillingService);
  private confirm = inject(ConfirmService);

  protected readonly timezones = TIMEZONES;
  protected readonly currencies = CURRENCIES;
  protected money = formatMoney;
  protected date = fmtDate;
  protected taxPercent = bpsToPercent;

  protected loading = signal(true);
  protected pageError = signal('');
  protected busy = signal(false);
  protected status = signal<{ ok: boolean; text: string } | null>(null);

  // Policy form fields (defaults match a fresh site).
  protected timezone = signal('Africa/Nairobi');
  protected currency = signal('KES');
  protected dueDay = signal(5);
  protected graceDays = signal(7);
  protected warnDays = signal(3);
  protected autoValve = signal(false);

  protected tariffs = signal<Tariff[]>([]);
  protected tariffDraft = signal<TariffDraft | null>(null);
  protected tariffError = signal('');

  constructor() {
    void this.load();
  }

  protected reload(): void {
    this.loading.set(true);
    this.pageError.set('');
    void this.load();
  }

  protected num(e: Event): number {
    const v = parseInt((e.target as HTMLInputElement).value, 10);
    return Number.isFinite(v) ? v : 0;
  }

  private async load(): Promise<void> {
    const siteId = this.shell.siteId();
    try {
      const [settings, tariffs] = await Promise.all([
        this.billing.loadSettings(siteId),
        this.billing.listTariffs(siteId),
      ]);
      if (settings) {
        if (settings.timezone) this.timezone.set(settings.timezone);
        if (settings.currency) this.currency.set(settings.currency);
        if (settings.due_day) this.dueDay.set(settings.due_day);
        this.graceDays.set(settings.grace_days);
        this.warnDays.set(settings.warn_days);
        this.autoValve.set(settings.auto_valve_enabled);
      }
      this.tariffs.set(tariffs);
    } catch (e) {
      this.pageError.set(pbMessage(e));
    } finally {
      this.loading.set(false);
    }
  }

  protected async saveSettings(): Promise<void> {
    if (this.busy()) return;
    this.busy.set(true);
    this.status.set(null);
    try {
      await this.billing.saveSettings(this.shell.siteId(), {
        timezone: this.timezone(),
        due_day: this.dueDay(),
        grace_days: this.graceDays(),
        warn_days: this.warnDays(),
        auto_valve_enabled: this.autoValve(),
        currency: this.currency(),
      });
      this.status.set({ ok: true, text: 'Billing policy saved.' });
    } catch (e) {
      this.status.set({ ok: false, text: pbMessage(e) });
    } finally {
      this.busy.set(false);
    }
  }

  // --- Tariffs -----------------------------------------------------------------
  protected openTariff(t?: Tariff): void {
    this.tariffError.set('');
    this.tariffDraft.set(
      t
        ? {
            id: t.id,
            name: t.name,
            rate_per_kl: (t.rate_per_kl_minor / 100).toFixed(2),
            standing_charge: (t.standing_charge_minor / 100).toFixed(2),
            minimum_charge: (t.minimum_charge_minor / 100).toFixed(2),
            tax_percent: bpsToPercent(t.tax_bps),
            effective_from: t.effective_from ? t.effective_from.slice(0, 10) : '',
            effective_until: t.effective_until ? t.effective_until.slice(0, 10) : '',
            status: t.status || 'active',
          }
        : {
            name: '',
            rate_per_kl: '',
            standing_charge: '',
            minimum_charge: '',
            tax_percent: null,
            effective_from: new Date().toISOString().slice(0, 10),
            effective_until: '',
            status: 'active',
          },
    );
  }

  protected async saveTariff(): Promise<void> {
    const d = this.tariffDraft();
    if (!d || this.busy()) return;
    // Convert major units → minor at the form boundary; '' reads as zero.
    const rate = parseMoneyToMinor(d.rate_per_kl || '0');
    const standing = parseMoneyToMinor(d.standing_charge || '0');
    const minimum = parseMoneyToMinor(d.minimum_charge || '0');
    if (rate === null || standing === null || minimum === null) {
      this.tariffError.set('Amounts must be numbers like 85 or 85.50.');
      return;
    }
    if (!d.effective_from) {
      this.tariffError.set('Effective-from date is required.');
      return;
    }
    this.busy.set(true);
    this.tariffError.set('');
    try {
      const row = {
        name: d.name.trim(),
        rate_per_kl_minor: rate,
        standing_charge_minor: standing,
        minimum_charge_minor: minimum,
        tax_bps: Math.max(0, percentToBps(d.tax_percent ?? 0)),
        effective_from: new Date(d.effective_from + 'T00:00:00Z').toISOString(),
        effective_until: d.effective_until ? new Date(d.effective_until + 'T00:00:00Z').toISOString() : '',
        status: d.status as Tariff['status'],
      };
      if (d.id) await this.billing.updateTariff(d.id, row);
      else await this.billing.createTariff(this.shell.siteId(), row);
      this.tariffDraft.set(null);
      this.status.set({ ok: true, text: 'Tariff saved.' });
      this.tariffs.set(await this.billing.listTariffs(this.shell.siteId()));
    } catch (e) {
      this.tariffError.set(pbMessage(e));
    } finally {
      this.busy.set(false);
    }
  }

  protected async removeTariff(t: Tariff): Promise<void> {
    const ok = await this.confirm.confirm({
      title: `Delete tariff ${t.name}?`,
      message: 'This removes the tariff. Already-issued invoices keep their copied line values, but new invoice preparation may fail without an active tariff.',
      confirmLabel: 'Delete',
      variant: 'error',
    });
    if (!ok) return;
    try {
      await this.billing.deleteTariff(t.id);
      this.status.set({ ok: true, text: `Tariff ${t.name} deleted.` });
      this.tariffs.set(await this.billing.listTariffs(this.shell.siteId()));
    } catch (e) {
      this.status.set({ ok: false, text: pbMessage(e) });
    }
  }
}
