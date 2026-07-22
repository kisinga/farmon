import { Component, inject, signal } from '@angular/core';
import { ConfirmService } from '../../core/services/confirm.service';
import { BillingService, type Tariff } from './billing.service';
import { BillingShellComponent } from './billing-shell.component';
import { formatMoney, parseMoneyToMinor, fmtDate } from './billing-format';

/** IANA zones offered in the picker — East Africa first, Nairobi the default. */
const TIMEZONES = [
  'Africa/Nairobi',
  'Africa/Dar_es_Salaam',
  'Africa/Kampala',
  'Africa/Kigali',
  'Africa/Addis_Ababa',
  'UTC',
];

/** Tariff modal draft: money fields in KES major units (converted on save). */
interface TariffDraft {
  id?: string;
  name: string;
  rate_per_kl: string;
  standing_charge: string;
  minimum_charge: string;
  tax_bps: number;
  effective_from: string;
  effective_until: string;
  status: string;
}

/**
 * Billing settings: the one-row-per-site billing_settings record (create-if-
 * missing on save) plus tariff CRUD-lite. The auto-valve toggle arms the
 * arrears → disconnection automation, so it carries explicit warning copy.
 */
@Component({
  selector: 'app-billing-settings',
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
        <!-- Site billing policy -->
        <section>
          <h2 class="section-label mb-3">Billing policy</h2>
          <div class="surface px-5 py-4 flex flex-col gap-3">
            <label class="flex flex-col gap-1">
              <span class="text-[11px] font-medium text-base-content/50">Timezone</span>
              <select class="select select-sm select-bordered" [value]="timezone()" (change)="timezone.set($any($event.target).value)">
                @for (tz of timezones; track tz) { <option [value]="tz">{{ tz }}</option> }
              </select>
            </label>
            <div class="grid grid-cols-3 gap-3">
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
            <div class="rounded-2xl border border-dashed border-base-300/50 py-8 text-center">
              <p class="text-sm text-base-content/50">No tariffs yet — invoices can't be prepared without an active tariff.</p>
            </div>
          } @else {
            <div class="surface divide-y divide-base-300/20">
              @for (t of tariffs(); track t.id) {
                <div class="flex items-center gap-3 px-5 py-2.5">
                  <div class="flex-1 min-w-0">
                    <p class="text-sm font-medium truncate">{{ t.name }}</p>
                    <p class="text-[11px] text-base-content/50">
                      {{ money(t.rate_per_kl_minor) }}/kl
                      @if (t.standing_charge_minor) { <span> · standing {{ money(t.standing_charge_minor) }}</span> }
                      @if (t.minimum_charge_minor) { <span> · min {{ money(t.minimum_charge_minor) }}</span> }
                      @if (t.tax_bps) { <span> · tax {{ t.tax_bps / 100 }}%</span> }
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
          <label class="flex flex-col mb-3">
            <span class="label-text mb-1">Name</span>
            <input class="input input-bordered w-full" placeholder="e.g. Residential 2026" [value]="d.name" (input)="d.name = $any($event.target).value" />
          </label>
          <label class="flex flex-col mb-3">
            <span class="label-text mb-1">Rate per kilolitre (KES/kl)</span>
            <input class="input input-bordered w-full" placeholder="e.g. 85.00" [value]="d.rate_per_kl" (input)="d.rate_per_kl = $any($event.target).value" />
          </label>
          <div class="grid grid-cols-2 gap-3 mb-3">
            <label class="flex flex-col">
              <span class="label-text mb-1">Standing charge (KES)</span>
              <input class="input input-bordered w-full" placeholder="0.00" [value]="d.standing_charge" (input)="d.standing_charge = $any($event.target).value" />
            </label>
            <label class="flex flex-col">
              <span class="label-text mb-1">Minimum charge (KES)</span>
              <input class="input input-bordered w-full" placeholder="0.00" [value]="d.minimum_charge" (input)="d.minimum_charge = $any($event.target).value" />
            </label>
          </div>
          <label class="flex flex-col mb-3">
            <span class="label-text mb-1">Tax (basis points — 1600 = 16%)</span>
            <input type="number" min="0" class="input input-bordered w-full" [value]="d.tax_bps" (input)="d.tax_bps = +$any($event.target).value || 0" />
          </label>
          <div class="grid grid-cols-2 gap-3 mb-3">
            <label class="flex flex-col">
              <span class="label-text mb-1">Effective from</span>
              <input type="date" class="input input-bordered w-full" [value]="d.effective_from" (input)="d.effective_from = $any($event.target).value" />
            </label>
            <label class="flex flex-col">
              <span class="label-text mb-1">Effective until (optional)</span>
              <input type="date" class="input input-bordered w-full" [value]="d.effective_until" (input)="d.effective_until = $any($event.target).value" />
            </label>
          </div>
          <label class="flex flex-col">
            <span class="label-text mb-1">Status</span>
            <select class="select select-bordered w-full" [value]="d.status" (change)="d.status = $any($event.target).value">
              <option value="active">active</option>
              <option value="retired">retired</option>
            </select>
          </label>
          @if (tariffError()) { <p class="text-error text-xs mt-2">{{ tariffError() }}</p> }
          <div class="modal-action">
            <button class="btn btn-ghost" (click)="tariffDraft.set(null)" [disabled]="busy()">Cancel</button>
            <button class="btn btn-primary" [disabled]="!d.name.trim() || busy()" (click)="saveTariff()">
              @if (busy()) { <span class="loading loading-spinner loading-xs"></span> }
              Save
            </button>
          </div>
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
  protected money = formatMoney;
  protected date = fmtDate;

  protected loading = signal(true);
  protected busy = signal(false);
  protected status = signal<{ ok: boolean; text: string } | null>(null);

  // Policy form fields (defaults match a fresh site).
  protected timezone = signal('Africa/Nairobi');
  protected dueDay = signal(5);
  protected graceDays = signal(7);
  protected warnDays = signal(3);
  protected autoValve = signal(false);
  private currency = 'KES';

  protected tariffs = signal<Tariff[]>([]);
  protected tariffDraft = signal<TariffDraft | null>(null);
  protected tariffError = signal('');

  constructor() {
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
        if (settings.due_day) this.dueDay.set(settings.due_day);
        this.graceDays.set(settings.grace_days);
        this.warnDays.set(settings.warn_days);
        this.autoValve.set(settings.auto_valve_enabled);
        if (settings.currency) this.currency = settings.currency;
      }
      this.tariffs.set(tariffs);
    } catch (e) {
      this.status.set({ ok: false, text: e instanceof Error ? e.message : String(e) });
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
        currency: this.currency,
      });
      this.status.set({ ok: true, text: 'Billing policy saved.' });
    } catch (e) {
      this.status.set({ ok: false, text: e instanceof Error ? e.message : String(e) });
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
            tax_bps: t.tax_bps,
            effective_from: t.effective_from ? t.effective_from.slice(0, 10) : '',
            effective_until: t.effective_until ? t.effective_until.slice(0, 10) : '',
            status: t.status || 'active',
          }
        : {
            name: '',
            rate_per_kl: '',
            standing_charge: '',
            minimum_charge: '',
            tax_bps: 0,
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
        tax_bps: Math.max(0, Math.round(d.tax_bps)),
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
      this.tariffError.set(e instanceof Error ? e.message : String(e));
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
      this.status.set({ ok: false, text: e instanceof Error ? e.message : String(e) });
    }
  }
}
