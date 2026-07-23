import { Component, computed, effect, inject, input, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { BillingService, type MeterDevice } from '../../billing/billing.service';
import { formatLitres, fmtDateTime, PENDING_COPY } from '../../billing/billing-format';

interface MeterRow {
  meter: MeterDevice;
  /** A downlink is queued (or sent, awaiting the meter's ack) for this meter. */
  pending: boolean;
}

/**
 * MeterValveComponent — the dashboard's per-meter valve summary: one row per
 * claimed meter with its valve state, last reading and last contact, plus the
 * mandated pending-command badge when a downlink is waiting for the meter's
 * next contact window. Links through to the billing meters page (where valve
 * control lives — this card is read-only).
 *
 * Cloud-only and entitlement-gated (`tenant_billing`) by its registry def.
 * Self-loading with a quiet spinner / quiet error line — the dashboard must
 * never break because billing did. A meter whose command list fails to load
 * simply shows no badge (fail quiet, never crash).
 */
@Component({
  selector: 'app-meter-valve',
  standalone: true,
  imports: [RouterLink],
  template: `
    <div class="rounded-xl border border-base-300/40 bg-base-100 p-4 h-full">
      <div class="flex flex-wrap items-center justify-between gap-2">
        <h3 class="text-sm font-semibold text-base-content/70">Meter valves</h3>
        <a class="link link-hover text-xs text-base-content/50"
           [routerLink]="['/site', siteId(), 'billing', 'meters']">Manage meters →</a>
      </div>

      @if (loading()) {
        <div class="py-8 flex items-center justify-center gap-2 text-base-content/30">
          <span class="loading loading-spinner loading-sm"></span>
        </div>
      } @else if (error(); as e) {
        <p class="py-8 text-center text-xs text-base-content/40" [title]="e">Couldn't load meters — open the billing section to retry.</p>
      } @else if (rows().length === 0) {
        <p class="py-8 text-center text-xs text-base-content/40">No meters claimed yet.</p>
      } @else {
        <div class="mt-3 divide-y divide-base-300/20">
          @for (r of rows(); track r.meter.id) {
            <div class="flex items-center gap-3 py-2.5 first:pt-0 last:pb-0">
              <span class="w-2 h-2 rounded-full shrink-0"
                    [title]="'Valve ' + (r.meter.valve_state || 'unknown')"
                    [class]="r.meter.valve_state === 'open' ? 'bg-success' : r.meter.valve_state === 'closed' ? 'bg-error' : 'bg-base-content/30'"></span>
              <div class="flex-1 min-w-0">
                <p class="text-sm font-medium truncate">{{ r.meter.name || r.meter.imei }}</p>
                <p class="text-[11px] text-base-content/50 truncate">
                  valve {{ r.meter.valve_state || 'unknown' }}
                  · {{ r.meter.last_uplink_at ? dateTime(r.meter.last_uplink_at) : 'never reported' }}
                </p>
                @if (r.pending) {
                  <p class="text-[11px] text-warning mt-0.5">{{ pendingCopy }}</p>
                }
              </div>
              <span class="text-sm tabular-nums shrink-0">{{ litres(r.meter.last_reading_ml) }}</span>
            </div>
          }
        </div>
      }
    </div>
  `,
})
export class MeterValveComponent {
  private billing = inject(BillingService);

  readonly siteId = input.required<string>();

  protected readonly pendingCopy = PENDING_COPY;
  protected litres = formatLitres;
  protected dateTime = fmtDateTime;

  protected loading = signal(true);
  protected error = signal('');
  private meters = signal<MeterDevice[]>([]);
  /** meter id → a queued/sent downlink is waiting on the meter's next contact. */
  private pendingByMeter = signal<Map<string, boolean>>(new Map());

  protected rows = computed<MeterRow[]>(() =>
    this.meters().map((meter) => ({ meter, pending: this.pendingByMeter().get(meter.id) ?? false })),
  );

  constructor() {
    // Reload on site change — the dashboard shell is reused across
    // /site/:name navigations, so this widget is NOT remounted.
    effect(() => void this.load(this.siteId()));
  }

  private async load(siteId: string): Promise<void> {
    this.loading.set(true);
    this.error.set('');
    try {
      const meters = await this.billing.listMeters(siteId);
      this.meters.set(meters);
      // One command-audit fetch per meter; a failure means "no badge", not a broken card.
      const pending = await Promise.all(
        meters.map(async (m): Promise<[string, boolean]> => {
          try {
            const commands = await this.billing.meterCommands(m.id);
            return [m.id, commands.some((c) => c.status === 'queued' || c.status === 'sent')];
          } catch {
            return [m.id, false];
          }
        }),
      );
      this.pendingByMeter.set(new Map(pending));
    } catch (e) {
      this.error.set(e instanceof Error ? e.message : String(e));
    } finally {
      this.loading.set(false);
    }
  }
}
