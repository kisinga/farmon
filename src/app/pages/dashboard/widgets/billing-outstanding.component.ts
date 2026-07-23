import { Component, computed, effect, inject, input, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { BillingService, type Invoice } from '../../billing/billing.service';
import { formatMoney } from '../../billing/billing-format';

/**
 * BillingOutstandingComponent — the dashboard's tenant-billing debt summary:
 * the site's outstanding total (sum of total − allocated over issued /
 * partially_paid / overdue invoices, mirroring the billing overview's roll-up)
 * plus the overdue invoice count, linking through to the billing section.
 *
 * Cloud-only and entitlement-gated (`tenant_billing`) by its registry def, so
 * it only ever mounts where the billing API is reachable. Self-loading like
 * the sibling widgets: a quiet spinner while fetching, a quiet line on error —
 * the dashboard must never break because billing did.
 */
@Component({
  selector: 'app-billing-outstanding',
  standalone: true,
  imports: [RouterLink],
  template: `
    <div class="rounded-xl border border-base-300/40 bg-base-100 p-4 h-full">
      <div class="flex flex-wrap items-center justify-between gap-2">
        <h3 class="text-sm font-semibold text-base-content/70">Billing</h3>
        <a class="link link-hover text-xs text-base-content/50"
           [routerLink]="['/site', siteId(), 'billing']">Open billing →</a>
      </div>

      @if (loading()) {
        <div class="py-8 flex items-center justify-center gap-2 text-base-content/30">
          <span class="loading loading-spinner loading-sm"></span>
        </div>
      } @else if (error(); as e) {
        <p class="py-8 text-center text-xs text-base-content/40" [title]="e">Couldn't load billing — open the billing section to retry.</p>
      } @else {
        <div class="mt-3 flex items-end justify-between gap-3">
          <div class="flex items-baseline gap-1.5 min-w-0">
            <span class="text-2xl font-bold tabular-nums tracking-tight truncate">{{ total() }}</span>
            <span class="text-sm font-medium text-base-content/45 shrink-0">outstanding</span>
          </div>
          @if (overdueCount() > 0) {
            <span class="badge badge-error badge-sm shrink-0">{{ overdueCount() }} overdue</span>
          } @else {
            <span class="text-xs text-base-content/45 shrink-0">nothing overdue</span>
          }
        </div>
      }
    </div>
  `,
})
export class BillingOutstandingComponent {
  private billing = inject(BillingService);

  readonly siteId = input.required<string>();

  protected loading = signal(true);
  protected error = signal('');
  private invoices = signal<Invoice[]>([]);

  /** Outstanding = total − allocated over the outstanding set (issued /
   *  partially_paid / overdue) — the same roll-up as the billing overview. */
  private outstandingMinor = computed(() =>
    this.invoices().reduce((sum, inv) => sum + Math.max(0, inv.total_minor - inv.allocated_minor), 0));
  protected overdueCount = computed(() => this.invoices().filter((i) => i.status === 'overdue').length);
  /** Currency from the invoices themselves (one currency per site); KES fallback. */
  private currency = computed(() => this.invoices().find((i) => i.currency)?.currency || 'KES');
  protected total = computed(() => formatMoney(this.outstandingMinor(), this.currency()));

  constructor() {
    // Reload on site change — the dashboard shell is reused across
    // /site/:name navigations, so this widget is NOT remounted.
    effect(() => void this.load(this.siteId()));
  }

  private async load(siteId: string): Promise<void> {
    this.loading.set(true);
    this.error.set('');
    try {
      this.invoices.set(await this.billing.listOutstanding(siteId));
    } catch (e) {
      this.error.set(e instanceof Error ? e.message : String(e));
    } finally {
      this.loading.set(false);
    }
  }
}
