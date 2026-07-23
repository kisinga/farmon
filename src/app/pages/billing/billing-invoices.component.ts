import { Component, computed, inject, signal } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { ConfirmService } from '../../core/services/confirm.service';
import {
  BillingService,
  type BillingCycle,
  type Invoice,
  type InvoiceLine,
  type InvoiceStatusFilter,
  type PaymentResult,
  type TenantAccount,
} from './billing.service';
import { BillingShellComponent } from './billing-shell.component';
import { BillingBannerComponent, BillingEmptyStateComponent, BillingPageErrorComponent } from './billing-ui';
import { formatMoney, formatLitres, parseMoneyToMinor, fmtDate, pbMessage } from './billing-format';

/** Invoices per fetch window — the list pages 100 at a time, newest first. */
const PAGE_SIZE = 100;

/**
 * Billing invoices: billing cycles (with Issue for prepared ones), the paged
 * invoice table with status chips + line-item detail, and the manual-payment
 * form whose response shows how the payment was allocated across invoices.
 *
 * All financial writes ride the custom routes — collections are read-only here.
 * Money enters the form in major units and is converted to minor units at the
 * boundary (parseMoneyToMinor).
 *
 * Arrears intent (warned_at / closed_at) is shown as small badges next to the
 * status: closed_at records that the automation INITIATED a valve closure —
 * the meter's live valve state is a meters-page concern, not duplicated here.
 */
@Component({
  selector: 'app-billing-invoices',
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

      <div class="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start mb-6">
        <!-- Cycles -->
        <section>
          <h2 class="section-label mb-3">Billing cycles</h2>
          @if (cycles().length === 0) {
            <app-billing-empty-state title="No billing cycles yet" hint="Cycles are prepared by the billing scheduler." />
          } @else {
            <div class="surface divide-y divide-base-300/20">
              @for (c of cycles(); track c.id) {
                <div class="flex items-center gap-3 px-4 py-2.5">
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
              <button class="btn btn-xs btn-ghost mt-2" (click)="filterCycle('')">Show all cycles</button>
            }
          }
        </section>

        <!-- Record payment -->
        <section>
          <h2 class="section-label mb-3">Record payment</h2>
          <div class="surface px-5 py-4 flex flex-col gap-3">
            <label class="flex flex-col gap-1">
              <span class="text-[11px] font-medium text-base-content/50">Tenant account</span>
              <select class="select select-sm select-bordered" [value]="payTenant()" (change)="selectPayTenant($any($event.target).value)">
                <option value="" disabled>Select account…</option>
                @for (t of tenants(); track t.id) { <option [value]="t.id">{{ t.name }} ({{ t.account_number }})</option> }
              </select>
            </label>
            <div class="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <label class="flex flex-col gap-1">
                <span class="text-[11px] font-medium text-base-content/50">Amount</span>
                <input class="input input-sm input-bordered" inputmode="decimal" placeholder="e.g. 1500.00"
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
              <!-- Two independent failures, two messages. -->
              @if (payAmount().trim() && !payTenant()) {
                <p class="text-[11px] text-error mt-1">Select an account.</p>
              }
              @if (payAmount().trim() && !amountValid()) {
                <p class="text-[11px] text-error mt-1">Enter a valid amount (e.g. 1500 or 1500.50).</p>
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

      <!-- Invoices -->
      <section>
        <div class="flex flex-wrap items-center gap-2 mb-3">
          <h2 class="section-label">Invoices</h2>
          <span class="grow"></span>
          <!-- Status filter chips: same segmented-control idiom as the meters page. -->
          <div class="inline-flex rounded-lg bg-base-200 p-0.5 gap-0.5">
            @for (f of statusFilters; track f.key) {
              <button class="btn btn-xs btn-ghost rounded-md normal-case"
                      [class.bg-base-100]="statusFilter() === f.key" [class.shadow-sm]="statusFilter() === f.key"
                      (click)="setStatusFilter(f.key)">{{ f.label }}</button>
            }
          </div>
        </div>
        <!-- Account handoff: the overview's debt rows deep-link here with
             ?account=<id>; the chip makes the filter visible and clearable. -->
        @if (accountFilter()) {
          <div class="flex items-center gap-2 mb-2">
            <span class="badge badge-info badge-sm">Account: {{ tenantLabel(accountFilter()) }}</span>
            <button class="btn btn-xs btn-ghost" (click)="clearAccountFilter()">Show all accounts</button>
          </div>
        }
        @if (invoices().length === 0) {
          <app-billing-empty-state title="No invoices{{ statusFilter() === 'all' ? '' : ' with this status' }}{{ cycleFilter() ? ' in this cycle' : '' }}{{ accountFilter() ? ' for this account' : '' }} yet" />
        } @else {
          <div class="surface overflow-x-auto">
            <!-- Desktop: real table; columns handle badge alignment (no fixed-width badge hack). -->
            <table class="table table-sm hidden md:table">
              <thead>
                <tr class="text-[11px] uppercase tracking-wide text-base-content/40 border-base-300/40">
                  <th>Invoice</th>
                  <th>Account</th>
                  <th>Cycle</th>
                  <th>Due</th>
                  <th class="text-right">Total</th>
                  <th class="text-right">Paid</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                @for (inv of invoices(); track inv.id) {
                  <tr class="hover:bg-base-200/30 cursor-pointer border-base-300/20"
                      [class.bg-base-200/40]="detail()?.id === inv.id" (click)="openDetail(inv)">
                    <td class="font-medium">{{ inv.invoice_number }}</td>
                    <td>{{ tenantLabel(inv.tenant_account) }}</td>
                    <td class="text-base-content/60">{{ cycleLabel(inv.cycle) }}</td>
                    <td class="tabular-nums">{{ date(inv.due_date) }}</td>
                    <td class="text-right tabular-nums font-medium">{{ money(inv.total_minor, inv.currency || 'KES') }}</td>
                    <td class="text-right tabular-nums text-base-content/60">{{ money(inv.allocated_minor, inv.currency || 'KES') }}</td>
                    <td>
                      <span class="badge badge-xs" [class]="statusBadge(inv)">{{ inv.status.replace('_', ' ') }}</span>
                      @if (inv.closed_at) {
                        <span class="badge badge-error badge-xs ml-1" [title]="'Valve closure initiated ' + date(inv.closed_at)">valve closure initiated</span>
                      } @else if (inv.warned_at) {
                        <span class="badge badge-warning badge-xs ml-1" [title]="'Reminder sent ' + date(inv.warned_at)">reminder sent</span>
                      }
                    </td>
                  </tr>
                }
              </tbody>
            </table>
            <!-- Mobile: stacked rows. -->
            <div class="md:hidden divide-y divide-base-300/20">
              @for (inv of invoices(); track inv.id) {
                <button type="button" class="w-full text-left flex items-center gap-3 px-4 py-2.5 hover:bg-base-200/30 transition-colors"
                        [class.bg-base-200/40]="detail()?.id === inv.id" (click)="openDetail(inv)">
                  <div class="flex-1 min-w-0">
                    <p class="text-sm font-medium truncate">{{ inv.invoice_number }} — {{ tenantLabel(inv.tenant_account) }}</p>
                    <p class="text-[11px] text-base-content/50">due {{ date(inv.due_date) }}</p>
                  </div>
                  <div class="text-right shrink-0">
                    <p class="text-sm tabular-nums font-medium">{{ money(inv.total_minor, inv.currency || 'KES') }}</p>
                    <p class="text-[11px] tabular-nums text-base-content/40">{{ money(inv.allocated_minor, inv.currency || 'KES') }} paid</p>
                  </div>
                  <div class="flex flex-col items-end gap-0.5 shrink-0">
                    <span class="badge badge-xs" [class]="statusBadge(inv)">{{ inv.status.replace('_', ' ') }}</span>
                    @if (inv.closed_at) {
                      <span class="badge badge-error badge-xs" [title]="'Valve closure initiated ' + date(inv.closed_at)">valve closure initiated</span>
                    } @else if (inv.warned_at) {
                      <span class="badge badge-warning badge-xs" [title]="'Reminder sent ' + date(inv.warned_at)">reminder sent</span>
                    }
                  </div>
                </button>
              }
            </div>
          </div>
          <div class="flex items-center gap-3 mt-2">
            <p class="text-[11px] text-base-content/40">Showing latest {{ invoices().length }} of {{ totalInvoices() }} invoice{{ totalInvoices() === 1 ? '' : 's' }}.</p>
            @if (invoices().length < totalInvoices()) {
              <button class="btn btn-xs btn-ghost" [disabled]="pagingBusy()" (click)="loadMore()">
                @if (pagingBusy()) { <span class="loading loading-spinner loading-xs"></span> }
                Load more
              </button>
            }
          </div>
        }

        <!-- Invoice detail -->
        @if (detail(); as inv) {
          <div class="rounded-xl border border-base-300/40 bg-base-100 p-4 mt-4">
            <div class="flex items-center gap-2 mb-2">
              <p class="text-sm font-semibold">{{ inv.invoice_number }}</p>
              <span class="badge badge-xs" [class]="statusBadge(inv)">{{ inv.status.replace('_', ' ') }}</span>
              @if (inv.closed_at) {
                <span class="badge badge-error badge-xs" [title]="'Valve closure initiated ' + date(inv.closed_at)">valve closure initiated</span>
              } @else if (inv.warned_at) {
                <span class="badge badge-warning badge-xs" [title]="'Reminder sent ' + date(inv.warned_at)">reminder sent</span>
              }
              <span class="text-[11px] text-base-content/50">{{ tenantLabel(inv.tenant_account) }} · due {{ date(inv.due_date) }}</span>
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
              <div class="border-t border-base-300/40 mt-2 pt-2 ml-auto w-full sm:w-72 flex flex-col gap-0.5 text-sm">
                <div class="flex justify-between"><span class="text-base-content/60">Subtotal</span><span class="tabular-nums">{{ money(inv.subtotal_minor, inv.currency || 'KES') }}</span></div>
                <div class="flex justify-between"><span class="text-base-content/60">Tax</span><span class="tabular-nums">{{ money(inv.tax_minor, inv.currency || 'KES') }}</span></div>
                <div class="flex justify-between font-semibold"><span>Total</span><span class="tabular-nums">{{ money(inv.total_minor, inv.currency || 'KES') }}</span></div>
                <div class="flex justify-between text-base-content/60"><span>Paid</span><span class="tabular-nums">{{ money(inv.allocated_minor, inv.currency || 'KES') }}</span></div>
              </div>
            }
          </div>
        }
      </section>
    }
  `,
})
export class BillingInvoicesComponent {
  private shell = inject(BillingShellComponent);
  private billing = inject(BillingService);
  private confirm = inject(ConfirmService);
  private route = inject(ActivatedRoute);

  protected money = formatMoney;
  protected litres = formatLitres;
  protected date = fmtDate;

  protected loading = signal(true);
  protected pageError = signal('');
  protected status = signal<{ ok: boolean; text: string } | null>(null);

  protected cycles = signal<BillingCycle[]>([]);
  /** Accumulated window of invoices (newest first), paged PAGE_SIZE at a time. */
  protected invoices = signal<Invoice[]>([]);
  protected totalInvoices = signal(0);
  private page = 1;
  protected pagingBusy = signal(false);
  protected tenants = signal<TenantAccount[]>([]);
  protected cycleFilter = signal('');
  /** Deep-link handoff from the overview's debt rows (?account=<id>). */
  protected accountFilter = signal(this.route.snapshot.queryParamMap.get('account') ?? '');
  protected statusFilter = signal<InvoiceStatusFilter>('all');
  protected readonly statusFilters: { key: InvoiceStatusFilter; label: string }[] = [
    { key: 'all', label: 'All' },
    { key: 'unpaid', label: 'Unpaid' },
    { key: 'overdue', label: 'Overdue' },
    { key: 'paid', label: 'Paid' },
  ];

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
  private cycleMap = computed(() => new Map(this.cycles().map((c) => [c.id, c])));
  private invoiceMap = computed(() => new Map(this.invoices().map((i) => [i.id, i])));

  protected tenantLabel(id: string): string {
    return this.tenantMap().get(id)?.name ?? id;
  }
  protected cycleLabel(id: string): string {
    const c = this.cycleMap().get(id);
    return c ? `${fmtDate(c.period_start)} – ${fmtDate(c.period_end)}` : '';
  }
  protected invoiceNumber(id: string): string {
    return this.invoiceMap().get(id)?.invoice_number ?? id;
  }

  protected statusBadge(inv: Invoice): string {
    switch (inv.status) {
      case 'paid': return 'badge-success';
      case 'overdue': return 'badge-error';
      case 'partially_paid': return 'badge-warning';
      case 'issued': return 'badge-info';
      default: return 'badge-ghost';
    }
  }

  /** Amount alone (the account is a separate failure with its own message). */
  protected amountValid = computed(() => {
    const minor = parseMoneyToMinor(this.payAmount());
    return minor !== null && minor > 0;
  });

  /** Payment form is valid with an account + a parseable positive amount. */
  protected payValid = computed(() => !!this.payTenant() && this.amountValid());

  constructor() {
    void this.load();
  }

  protected reload(): void {
    this.loading.set(true);
    this.pageError.set('');
    void this.load();
  }

  private async load(): Promise<void> {
    const siteId = this.shell.siteId();
    try {
      const [cycles, , tenants] = await Promise.all([
        this.billing.listCycles(siteId),
        this.fetchInvoices(true),
        this.billing.listTenants(siteId),
      ]);
      this.cycles.set(cycles);
      this.tenants.set(tenants);
    } catch (e) {
      this.pageError.set(pbMessage(e));
    } finally {
      this.loading.set(false);
    }
  }

  /** Fetch one window of invoices with the active filters; reset starts over at page 1. */
  private async fetchInvoices(reset: boolean): Promise<void> {
    if (reset) this.page = 1;
    const r = await this.billing.listInvoices(this.shell.siteId(), {
      cycleId: this.cycleFilter() || undefined,
      accountId: this.accountFilter() || undefined,
      status: this.statusFilter(),
      page: this.page,
      perPage: PAGE_SIZE,
    });
    this.invoices.update((cur) => (reset ? r.items : [...cur, ...r.items]));
    this.totalInvoices.set(r.totalItems);
  }

  protected async loadMore(): Promise<void> {
    if (this.pagingBusy()) return;
    this.pagingBusy.set(true);
    try {
      this.page += 1;
      await this.fetchInvoices(false);
    } catch (e) {
      this.page -= 1;
      this.status.set({ ok: false, text: pbMessage(e) });
    } finally {
      this.pagingBusy.set(false);
    }
  }

  protected async filterCycle(cycleId: string): Promise<void> {
    this.cycleFilter.set(cycleId);
    this.detail.set(null);
    await this.fetchInvoices(true);
  }

  protected async setStatusFilter(f: InvoiceStatusFilter): Promise<void> {
    if (this.statusFilter() === f) return;
    this.statusFilter.set(f);
    this.detail.set(null);
    await this.fetchInvoices(true);
  }

  protected async clearAccountFilter(): Promise<void> {
    this.accountFilter.set('');
    await this.fetchInvoices(true);
  }

  /** Changing the payment account invalidates the previous allocation panel. */
  protected selectPayTenant(id: string): void {
    this.payTenant.set(id);
    this.payResult.set(null);
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
      await this.fetchInvoices(true);
    } catch (e) {
      this.status.set({ ok: false, text: pbMessage(e) });
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
      // Allocations change invoice balances — refresh the window.
      await this.fetchInvoices(true);
    } catch (e) {
      this.status.set({ ok: false, text: pbMessage(e) });
    } finally {
      this.payBusy.set(false);
    }
  }
}
