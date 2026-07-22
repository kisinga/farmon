import { Component, computed, inject, signal } from '@angular/core';
import { ConfirmService } from '../../core/services/confirm.service';
import { BillingService, type BillingCycle, type Invoice, type InvoiceLine, type PaymentResult, type TenantAccount } from './billing.service';
import { BillingShellComponent } from './billing-shell.component';
import { formatMoney, formatLitres, parseMoneyToMinor, fmtDate } from './billing-format';

/**
 * Billing invoices: billing cycles (with Issue for prepared ones), the invoice
 * list (all or per cycle) with a line-item detail view, and the manual-payment
 * form whose response shows how the payment was allocated across invoices.
 *
 * All financial writes ride the custom routes — collections are read-only here.
 * Money enters the form in KES major units and is converted to minor units at
 * the boundary (parseMoneyToMinor).
 */
@Component({
  selector: 'app-billing-invoices',
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
        <div class="flex flex-col gap-6">
          <!-- Cycles -->
          <section>
            <h2 class="section-label mb-3">Billing cycles</h2>
            @if (cycles().length === 0) {
              <div class="rounded-2xl border border-dashed border-base-300/50 py-8 text-center">
                <p class="text-sm text-base-content/50">No billing cycles yet — cycles are prepared by the billing scheduler.</p>
              </div>
            } @else {
              <div class="surface divide-y divide-base-300/20">
                @for (c of cycles(); track c.id) {
                  <div class="flex items-center gap-3 px-5 py-2.5">
                    <button type="button" class="flex-1 min-w-0 text-left" (click)="filterCycle(cycleFilter() === c.id ? '' : c.id)">
                      <p class="text-sm font-medium" [class.text-primary]="cycleFilter() === c.id">
                        {{ date(c.period_start) }} – {{ date(c.period_end) }}
                      </p>
                      <p class="text-[11px] text-base-content/50">due {{ date(c.due_date) }}</p>
                    </button>
                    <span class="badge badge-xs shrink-0"
                      [class]="c.status === 'issued' ? 'badge-info' : c.status === 'closed' ? 'badge-ghost' : c.status === 'prepared' ? 'badge-warning' : 'badge-ghost'">{{ c.status }}</span>
                    @if (c.status === 'prepared') {
                      <button class="btn btn-xs btn-primary shrink-0" [disabled]="issueBusy()" (click)="issue(c)">Issue</button>
                    }
                  </div>
                }
              </div>
              @if (cycleFilter()) {
                <button class="btn btn-xs btn-ghost mt-2" (click)="filterCycle('')">Show all invoices</button>
              }
            }
          </section>

          <!-- Record payment -->
          <section>
            <h2 class="section-label mb-3">Record payment</h2>
            <div class="surface px-5 py-4 flex flex-col gap-3">
              <label class="flex flex-col gap-1">
                <span class="text-[11px] font-medium text-base-content/50">Tenant account</span>
                <select class="select select-sm select-bordered" [value]="payTenant()" (change)="payTenant.set($any($event.target).value)">
                  <option value="" disabled>Select account…</option>
                  @for (t of tenants(); track t.id) { <option [value]="t.id">{{ t.name }} ({{ t.account_number }})</option> }
                </select>
              </label>
              <div class="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <label class="flex flex-col gap-1">
                  <span class="text-[11px] font-medium text-base-content/50">Amount (KES)</span>
                  <input class="input input-sm input-bordered" placeholder="e.g. 1500.00"
                         [value]="payAmount()" (input)="payAmount.set($any($event.target).value)" />
                </label>
                <label class="flex flex-col gap-1">
                  <span class="text-[11px] font-medium text-base-content/50">Payer phone (optional)</span>
                  <input class="input input-sm input-bordered" placeholder="+2547…"
                         [value]="payPhone()" (input)="payPhone.set($any($event.target).value)" />
                </label>
                <label class="flex flex-col gap-1">
                  <span class="text-[11px] font-medium text-base-content/50">Reference (optional)</span>
                  <input class="input input-sm input-bordered" placeholder="receipt no."
                         [value]="payRef()" (input)="payRef.set($any($event.target).value)" />
                </label>
              </div>
              <div>
                <button class="btn btn-sm btn-primary" [disabled]="!payValid() || payBusy()" (click)="recordPayment()">
                  @if (payBusy()) { <span class="loading loading-spinner loading-xs"></span> }
                  Record payment
                </button>
                @if (payAmount().trim() && !payValid()) {
                  <p class="text-[11px] text-error mt-1">Select an account and enter a valid amount (e.g. 1500 or 1500.50).</p>
                }
              </div>

              @if (payResult(); as r) {
                <div class="rounded-xl ring-1 ring-success/40 bg-success/5 px-4 py-3">
                  <p class="text-xs font-semibold">Payment recorded — {{ r.processing_status.replace('_', ' ') }}</p>
                  @if (r.allocations.length === 0) {
                    <p class="text-[11px] text-base-content/60 mt-1">No open invoices to allocate against; the balance sits unallocated on the account.</p>
                  } @else {
                    <p class="text-[11px] text-base-content/60 mt-1">Allocated oldest-debt-first:</p>
                    <ul class="text-[11px] mt-1 flex flex-col gap-0.5">
                      @for (a of r.allocations; track a.id) {
                        <li class="flex justify-between gap-3">
                          <span>{{ invoiceNumber(a.invoice) }}</span>
                          <span class="tabular-nums">{{ money(a.amount_minor) }}</span>
                        </li>
                      }
                    </ul>
                  }
                </div>
              }
            </div>
          </section>
        </div>

        <!-- Invoices + detail -->
        <section>
          <h2 class="section-label mb-3">Invoices{{ cycleFilter() ? ' in selected cycle' : '' }}</h2>
          @if (invoices().length === 0) {
            <div class="rounded-2xl border border-dashed border-base-300/50 py-8 text-center">
              <p class="text-sm text-base-content/50">No invoices{{ cycleFilter() ? ' in this cycle' : '' }} yet.</p>
            </div>
          } @else {
            <div class="surface divide-y divide-base-300/20">
              @for (inv of invoices(); track inv.id) {
                <button type="button" class="w-full text-left flex items-center gap-3 px-5 py-2.5 hover:bg-base-200/30 transition-colors"
                        [class.bg-base-200/40]="detail()?.id === inv.id" (click)="openDetail(inv)">
                  <div class="flex-1 min-w-0">
                    <p class="text-sm font-medium truncate">{{ inv.invoice_number }} — {{ tenantLabel(inv.tenant_account) }}</p>
                    <p class="text-[11px] text-base-content/50">due {{ date(inv.due_date) }}</p>
                  </div>
                  <div class="text-right shrink-0">
                    <p class="text-sm tabular-nums font-medium">{{ money(inv.total_minor, inv.currency || 'KES') }}</p>
                    <p class="text-[11px] tabular-nums text-base-content/40">
                      {{ money(inv.allocated_minor, inv.currency || 'KES') }} paid
                    </p>
                  </div>
                  <span class="badge badge-xs shrink-0 w-24 justify-center"
                    [class]="inv.status === 'paid' ? 'badge-success' : inv.status === 'overdue' ? 'badge-error' : inv.status === 'partially_paid' ? 'badge-warning' : inv.status === 'issued' ? 'badge-info' : 'badge-ghost'">{{ inv.status.replace('_', ' ') }}</span>
                </button>
              }
            </div>
          }

          <!-- Invoice detail -->
          @if (detail(); as inv) {
            <div class="surface px-5 py-4 mt-4">
              <div class="flex items-baseline gap-2 mb-2">
                <p class="text-sm font-semibold">{{ inv.invoice_number }}</p>
                <span class="text-[11px] text-base-content/50">{{ tenantLabel(inv.tenant_account) }}</span>
                <span class="grow"></span>
                <button class="btn btn-ghost btn-xs btn-circle" (click)="detail.set(null)" aria-label="Close detail">✕</button>
              </div>
              @if (linesLoading()) {
                <div class="flex justify-center py-6"><span class="loading loading-spinner loading-sm"></span></div>
              } @else {
                <div class="divide-y divide-base-300/20">
                  @for (l of lines(); track l.id) {
                    <div class="flex items-baseline gap-3 py-2">
                      <div class="flex-1 min-w-0">
                        <p class="text-sm truncate">{{ l.description || l.type.replace('_', ' ') }}</p>
                        <p class="text-[11px] text-base-content/40">
                          {{ l.type.replace('_', ' ') }}
                          @if (l.quantity_ml) { <span> · {{ litres(l.quantity_ml) }}</span> }
                          @if (l.quality === 'estimated') { <span class="text-warning"> · estimated</span> }
                        </p>
                      </div>
                      <span class="text-sm tabular-nums shrink-0">{{ money(l.amount_minor, inv.currency || 'KES') }}</span>
                    </div>
                  } @empty {
                    <p class="py-4 text-sm text-base-content/40">No line items.</p>
                  }
                </div>
                <div class="border-t border-base-300/40 mt-2 pt-2 flex flex-col gap-0.5 text-sm">
                  <div class="flex justify-between"><span class="text-base-content/60">Subtotal</span><span class="tabular-nums">{{ money(inv.subtotal_minor, inv.currency || 'KES') }}</span></div>
                  <div class="flex justify-between"><span class="text-base-content/60">Tax</span><span class="tabular-nums">{{ money(inv.tax_minor, inv.currency || 'KES') }}</span></div>
                  <div class="flex justify-between font-semibold"><span>Total</span><span class="tabular-nums">{{ money(inv.total_minor, inv.currency || 'KES') }}</span></div>
                  <div class="flex justify-between text-base-content/60"><span>Paid</span><span class="tabular-nums">{{ money(inv.allocated_minor, inv.currency || 'KES') }}</span></div>
                </div>
              }
            </div>
          }
        </section>
      </div>
    }
  `,
})
export class BillingInvoicesComponent {
  private shell = inject(BillingShellComponent);
  private billing = inject(BillingService);
  private confirm = inject(ConfirmService);

  protected money = formatMoney;
  protected litres = formatLitres;
  protected date = fmtDate;

  protected loading = signal(true);
  protected status = signal<{ ok: boolean; text: string } | null>(null);

  protected cycles = signal<BillingCycle[]>([]);
  protected invoices = signal<Invoice[]>([]);
  protected tenants = signal<TenantAccount[]>([]);
  protected cycleFilter = signal('');

  protected detail = signal<Invoice | null>(null);
  protected lines = signal<InvoiceLine[]>([]);
  protected linesLoading = signal(false);

  protected issueBusy = signal(false);

  protected payTenant = signal('');
  protected payAmount = signal('');
  protected payPhone = signal('');
  protected payRef = signal('');
  protected payBusy = signal(false);
  protected payResult = signal<PaymentResult | null>(null);

  private tenantMap = computed(() => new Map(this.tenants().map((t) => [t.id, t])));
  private invoiceMap = computed(() => new Map(this.invoices().map((i) => [i.id, i])));

  protected tenantLabel(id: string): string {
    return this.tenantMap().get(id)?.name ?? id;
  }
  protected invoiceNumber(id: string): string {
    return this.invoiceMap().get(id)?.invoice_number ?? id;
  }

  /** Payment form is valid with an account + a parseable positive amount. */
  protected payValid = computed(() => {
    const minor = parseMoneyToMinor(this.payAmount());
    return !!this.payTenant() && minor !== null && minor > 0;
  });

  constructor() {
    void this.load();
  }

  private async load(): Promise<void> {
    const siteId = this.shell.siteId();
    try {
      const [cycles, invoices, tenants] = await Promise.all([
        this.billing.listCycles(siteId),
        this.billing.listInvoices(siteId),
        this.billing.listTenants(siteId),
      ]);
      this.cycles.set(cycles);
      this.invoices.set(invoices);
      this.tenants.set(tenants);
    } catch (e) {
      this.status.set({ ok: false, text: e instanceof Error ? e.message : String(e) });
    } finally {
      this.loading.set(false);
    }
  }

  protected async filterCycle(cycleId: string): Promise<void> {
    this.cycleFilter.set(cycleId);
    this.detail.set(null);
    this.invoices.set(await this.billing.listInvoices(this.shell.siteId(), cycleId || undefined));
  }

  /** Issue a prepared cycle: normal confirm, then refresh cycles + invoices. */
  protected async issue(c: BillingCycle): Promise<void> {
    const ok = await this.confirm.confirm({
      title: 'Issue this billing cycle?',
      message: `This issues every draft invoice in the ${this.date(c.period_start)} – ${this.date(c.period_end)} cycle to its tenant account. Issued invoices become payable and start ageing toward their due date.`,
      confirmLabel: 'Issue invoices',
      variant: 'warning',
    });
    if (!ok || this.issueBusy()) return;
    this.issueBusy.set(true);
    this.status.set(null);
    try {
      const r = await this.billing.issueCycle(c.id);
      this.status.set({ ok: true, text: `Cycle issued — ${r.issued} invoice${r.issued === 1 ? '' : 's'} issued.` });
      this.cycles.set(await this.billing.listCycles(this.shell.siteId()));
      this.invoices.set(await this.billing.listInvoices(this.shell.siteId(), this.cycleFilter() || undefined));
    } catch (e) {
      this.status.set({ ok: false, text: e instanceof Error ? e.message : String(e) });
    } finally {
      this.issueBusy.set(false);
    }
  }

  protected async openDetail(inv: Invoice): Promise<void> {
    this.detail.set(inv);
    this.linesLoading.set(true);
    try {
      this.lines.set(await this.billing.invoiceLines(inv.id));
    } catch {
      this.lines.set([]);
    } finally {
      this.linesLoading.set(false);
    }
  }

  protected async recordPayment(): Promise<void> {
    const minor = parseMoneyToMinor(this.payAmount());
    if (!this.payTenant() || minor === null || minor <= 0 || this.payBusy()) return;
    this.payBusy.set(true);
    this.status.set(null);
    this.payResult.set(null);
    try {
      const r = await this.billing.recordPayment(this.shell.siteId(), {
        tenant_account: this.payTenant(),
        amount_minor: minor,
        payer_phone: this.payPhone().trim(),
        reference: this.payRef().trim(),
      });
      this.payResult.set(r);
      this.payAmount.set('');
      this.payPhone.set('');
      this.payRef.set('');
      // Allocations change invoice balances — refresh.
      this.invoices.set(await this.billing.listInvoices(this.shell.siteId(), this.cycleFilter() || undefined));
    } catch (e) {
      this.status.set({ ok: false, text: e instanceof Error ? e.message : String(e) });
    } finally {
      this.payBusy.set(false);
    }
  }
}
