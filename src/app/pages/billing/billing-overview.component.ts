import { Component, computed, inject, signal } from '@angular/core';
import { BillingService, type Invoice, type MeterDevice, type MeterEvent, type TenantAccount } from './billing.service';
import { BillingShellComponent } from './billing-shell.component';
import { formatMoney, fmtDateTime } from './billing-format';

interface TenantDebt {
  tenant: TenantAccount | null;
  outstanding_minor: number;
  overdue: number;
}

/**
 * Billing overview: the site's debt roll-up (outstanding per tenant account,
 * overdue invoice count), a meter summary (count + valve states) and the recent
 * meter-event feed. Read-only; the working surfaces are the sibling tabs.
 */
@Component({
  selector: 'app-billing-overview',
  standalone: true,
  host: { class: 'block' },
  template: `
    @if (loading()) {
      <div class="flex items-center justify-center py-24"><span class="loading loading-spinner loading-lg"></span></div>
    } @else if (error(); as e) {
      <div role="alert" class="alert alert-error text-sm">{{ e }}</div>
    } @else {
      <!-- Headline stats -->
      <div class="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
        <div class="rounded-2xl ring-1 ring-base-300/40 bg-base-100 px-4 py-3">
          <p class="text-[11px] font-medium uppercase tracking-wide text-base-content/40">Outstanding</p>
          <p class="text-lg font-semibold tabular-nums mt-0.5">{{ money(totalOutstanding()) }}</p>
        </div>
        <div class="rounded-2xl ring-1 ring-base-300/40 bg-base-100 px-4 py-3">
          <p class="text-[11px] font-medium uppercase tracking-wide text-base-content/40">Overdue invoices</p>
          <p class="text-lg font-semibold tabular-nums mt-0.5" [class.text-error]="overdueCount() > 0">{{ overdueCount() }}</p>
        </div>
        <div class="rounded-2xl ring-1 ring-base-300/40 bg-base-100 px-4 py-3">
          <p class="text-[11px] font-medium uppercase tracking-wide text-base-content/40">Meters</p>
          <p class="text-lg font-semibold tabular-nums mt-0.5">{{ meters().length }}</p>
        </div>
        <div class="rounded-2xl ring-1 ring-base-300/40 bg-base-100 px-4 py-3">
          <p class="text-[11px] font-medium uppercase tracking-wide text-base-content/40">Valves closed</p>
          <p class="text-lg font-semibold tabular-nums mt-0.5" [class.text-warning]="valveCount('closed') > 0">{{ valveCount('closed') }}</p>
        </div>
      </div>

      <div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <!-- Outstanding per tenant account -->
        <section>
          <h2 class="section-label mb-3">Outstanding by account</h2>
          @if (debts().length === 0) {
            <div class="rounded-2xl border border-dashed border-base-300/50 py-10 text-center">
              <p class="text-sm text-base-content/50">No outstanding invoices.</p>
            </div>
          } @else {
            <div class="surface divide-y divide-base-300/20">
              @for (d of debts(); track d.tenant?.id ?? 'unknown') {
                <div class="flex items-center gap-3 px-5 py-3">
                  <div class="flex-1 min-w-0">
                    <p class="text-sm font-medium truncate">{{ d.tenant?.name || 'Unknown account' }}</p>
                    <p class="text-[11px] text-base-content/50 truncate">
                      {{ d.tenant?.account_number }}
                      @if (d.overdue > 0) { <span class="text-error"> · {{ d.overdue }} overdue</span> }
                    </p>
                  </div>
                  <span class="text-sm font-semibold tabular-nums shrink-0">{{ money(d.outstanding_minor) }}</span>
                </div>
              }
            </div>
          }
        </section>

        <!-- Right column: meter valve states + recent events -->
        <div class="flex flex-col gap-6">
          <section>
            <h2 class="section-label mb-3">Meter valves</h2>
            @if (meters().length === 0) {
              <div class="rounded-2xl border border-dashed border-base-300/50 py-10 text-center">
                <p class="text-sm text-base-content/50">No meters claimed yet — claim one from the Meters tab.</p>
              </div>
            } @else {
              <div class="surface divide-y divide-base-300/20">
                @for (state of ['open', 'closed', 'unknown']; track state) {
                  <div class="flex items-center gap-3 px-5 py-2.5">
                    <span class="w-2 h-2 rounded-full shrink-0"
                      [class]="state === 'open' ? 'bg-success' : state === 'closed' ? 'bg-error' : 'bg-base-content/30'"></span>
                    <span class="text-sm capitalize flex-1">{{ state }}</span>
                    <span class="text-sm tabular-nums text-base-content/60">{{ valveCount(state) }}</span>
                  </div>
                }
              </div>
            }
          </section>

          <section>
            <h2 class="section-label mb-3">Recent meter events</h2>
            @if (events().length === 0) {
              <p class="text-sm text-base-content/40">No meter events.</p>
            } @else {
              <div class="surface divide-y divide-base-300/20">
                @for (ev of events(); track ev.id) {
                  <div class="px-5 py-2.5">
                    <p class="text-sm truncate">
                      @if (ev.severity === 'critical') { <span class="badge badge-error badge-xs mr-1">critical</span> }
                      @else if (ev.severity === 'warning') { <span class="badge badge-warning badge-xs mr-1">warning</span> }
                      {{ ev.message || ev.type }}
                    </p>
                    <p class="text-[11px] text-base-content/50">{{ dateTime(ev.occurred_at) }}</p>
                  </div>
                }
              </div>
            }
          </section>
        </div>
      </div>
    }
  `,
})
export class BillingOverviewComponent {
  private shell = inject(BillingShellComponent);
  private billing = inject(BillingService);

  protected loading = signal(true);
  protected error = signal('');
  protected invoices = signal<Invoice[]>([]);
  protected tenants = signal<TenantAccount[]>([]);
  protected meters = signal<MeterDevice[]>([]);
  protected events = signal<MeterEvent[]>([]);

  protected money = formatMoney;
  protected dateTime = fmtDateTime;

  /** Outstanding = total − allocated over issued/partially_paid/overdue invoices. */
  protected totalOutstanding = computed(() =>
    this.invoices().reduce((sum, inv) => sum + Math.max(0, inv.total_minor - inv.allocated_minor), 0));
  protected overdueCount = computed(() => this.invoices().filter((i) => i.status === 'overdue').length);

  protected debts = computed<TenantDebt[]>(() => {
    const byTenant = new Map<string, TenantDebt>();
    const tenants = new Map(this.tenants().map((t) => [t.id, t]));
    for (const inv of this.invoices()) {
      const due = Math.max(0, inv.total_minor - inv.allocated_minor);
      const entry = byTenant.get(inv.tenant_account) ?? {
        tenant: tenants.get(inv.tenant_account) ?? null,
        outstanding_minor: 0,
        overdue: 0,
      };
      entry.outstanding_minor += due;
      if (inv.status === 'overdue') entry.overdue++;
      byTenant.set(inv.tenant_account, entry);
    }
    return [...byTenant.values()].sort((a, b) => b.outstanding_minor - a.outstanding_minor);
  });

  protected valveCount(state: string): number {
    return this.meters().filter((m) => (m.valve_state || 'unknown') === state).length;
  }

  constructor() {
    void this.load();
  }

  private async load(): Promise<void> {
    const siteId = this.shell.siteId();
    try {
      const [invoices, tenants, meters, events] = await Promise.all([
        this.billing.listOutstanding(siteId),
        this.billing.listTenants(siteId),
        this.billing.listMeters(siteId),
        this.billing.listMeterEvents(siteId),
      ]);
      this.invoices.set(invoices);
      this.tenants.set(tenants);
      this.meters.set(meters);
      this.events.set(events);
    } catch (e) {
      this.error.set(e instanceof Error ? e.message : String(e));
    } finally {
      this.loading.set(false);
    }
  }
}
