import { Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { BillingService, type Invoice, type MeterDevice, type MeterEvent, type TenantAccount } from './billing.service';
import { BillingShellComponent } from './billing-shell.component';
import { BillingEmptyStateComponent, BillingPageErrorComponent, BillingStatCardComponent } from './billing-ui';
import { formatMoney, fmtDateTime, pbMessage } from './billing-format';

interface TenantDebt {
  tenant: TenantAccount | null;
  outstanding_minor: number;
  overdue: number;
}

/**
 * Billing overview: the site's debt roll-up (outstanding per tenant account,
 * overdue invoice count), headline meter stats and the recent meter-event
 * feed. Read-only; the working surfaces are the sibling tabs.
 *
 * Debt rows link through to the invoices page with an `account` queryParam so
 * the operator lands on that account's invoices, not a dead end.
 */
@Component({
  selector: 'app-billing-overview',
  standalone: true,
  imports: [RouterLink, BillingStatCardComponent, BillingEmptyStateComponent, BillingPageErrorComponent],
  host: { class: 'block' },
  template: `
    @if (loading()) {
      <div class="flex items-center justify-center py-24"><span class="loading loading-spinner loading-lg"></span></div>
    } @else if (error(); as e) {
      <app-billing-page-error [text]="e" (retry)="reload()" />
    } @else {
      <!-- Headline stats -->
      <div class="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
        <app-billing-stat-card label="Outstanding" [value]="money(totalOutstanding(), currency())" />
        <app-billing-stat-card label="Overdue invoices" [value]="overdueCount().toString()" [tone]="overdueCount() > 0 ? 'error' : 'default'" />
        <app-billing-stat-card label="Meters" [value]="meters().length.toString()" />
        <a [routerLink]="['/site', shell.siteId(), 'billing', 'meters']" class="block hover:opacity-80 transition-opacity">
          <app-billing-stat-card label="Valves closed" [value]="valveCount('closed').toString()"
            [tone]="valveCount('closed') > 0 ? 'warning' : 'default'" hint="View meters →" />
        </a>
      </div>

      <div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <!-- Outstanding per tenant account: each row links to that account's
             invoices (account queryParam handoff). -->
        <section>
          <h2 class="section-label mb-3">Outstanding by account</h2>
          @if (debts().length === 0) {
            <app-billing-empty-state title="No outstanding invoices" hint="Every issued invoice is fully paid." />
          } @else {
            <div class="surface divide-y divide-base-300/20">
              @for (d of debts(); track d.tenant?.id ?? 'unknown') {
                @if (d.tenant) {
                  <a [routerLink]="['/site', shell.siteId(), 'billing', 'invoices']" [queryParams]="{ account: d.tenant.id }"
                     class="flex items-center gap-3 px-5 py-3 hover:bg-base-200/30 transition-colors">
                    <div class="flex-1 min-w-0">
                      <p class="text-sm font-medium truncate">{{ d.tenant.name || 'Unknown account' }}</p>
                      <p class="text-[11px] text-base-content/50 truncate">
                        {{ d.tenant.account_number }}
                        @if (d.overdue > 0) { <span class="text-error"> · {{ d.overdue }} overdue</span> }
                      </p>
                    </div>
                    <span class="text-sm font-semibold tabular-nums shrink-0">{{ money(d.outstanding_minor, currency()) }}</span>
                    <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 shrink-0 text-base-content/30" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                      <path stroke-linecap="round" stroke-linejoin="round" d="M9 5l7 7-7 7"/>
                    </svg>
                  </a>
                } @else {
                  <div class="flex items-center gap-3 px-5 py-3">
                    <div class="flex-1 min-w-0">
                      <p class="text-sm font-medium truncate">Unknown account</p>
                      @if (d.overdue > 0) { <p class="text-[11px] text-error">{{ d.overdue }} overdue</p> }
                    </div>
                    <span class="text-sm font-semibold tabular-nums shrink-0">{{ money(d.outstanding_minor, currency()) }}</span>
                  </div>
                }
              }
            </div>
          }
        </section>

        <!-- Recent meter events: every row carries its severity badge. -->
        <section>
          <h2 class="section-label mb-3">Recent meter events</h2>
          @if (events().length === 0) {
            <app-billing-empty-state title="No meter events" hint="Valve actions, new-source-IP sightings and meter health notes land here." />
          } @else {
            <div class="surface divide-y divide-base-300/20">
              @for (ev of events(); track ev.id) {
                <div class="px-5 py-2.5">
                  <p class="text-sm truncate">
                    <span class="badge badge-xs mr-1" [class]="severityBadge(ev.severity)">{{ ev.severity || 'info' }}</span>
                    {{ ev.message || ev.type }}
                  </p>
                  <p class="text-[11px] text-base-content/50">{{ dateTime(ev.occurred_at) }}</p>
                </div>
              }
            </div>
          }
        </section>
      </div>
    }
  `,
})
export class BillingOverviewComponent {
  protected shell = inject(BillingShellComponent);
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
  /** Currency from the invoices themselves (one currency per site); KES fallback. */
  protected currency = computed(() => this.invoices().find((i) => i.currency)?.currency || 'KES');

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

  protected severityBadge(severity: MeterEvent['severity']): string {
    switch (severity) {
      case 'critical': return 'badge-error';
      case 'warning': return 'badge-warning';
      case 'info': return 'badge-info';
      default: return 'badge-ghost';
    }
  }

  constructor() {
    void this.load();
  }

  protected reload(): void {
    this.loading.set(true);
    this.error.set('');
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
      this.error.set(pbMessage(e));
    } finally {
      this.loading.set(false);
    }
  }
}
