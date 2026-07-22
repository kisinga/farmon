import { Injectable, inject } from '@angular/core';
import { BackendService } from '../../core/services/backend.service';

// --- Record shapes (PocketBase collections, migrations 57–59) ----------------

export interface BillingUnit {
  id: string;
  site: string;
  code: string;
  name: string;
  status: 'active' | 'vacant' | 'archived' | '';
}

export interface TenantAccount {
  id: string;
  site: string;
  account_number: string;
  name: string;
  phone: string;
  email: string;
  status: 'active' | 'inactive' | '';
  notes: string;
}

export interface Occupancy {
  id: string;
  site: string;
  unit: string;
  tenant_account: string;
  liable_from: string;
  liable_until: string;
  move_in_reading_ml: number;
  move_out_reading_ml: number;
  status: 'active' | 'ended' | '';
}

export interface BillingSettings {
  id: string; // '' when the site's row doesn't exist yet (create-if-missing on save)
  site: string;
  timezone: string;
  due_day: number;
  grace_days: number;
  warn_days: number;
  auto_valve_enabled: boolean;
  currency: string;
}

export interface Tariff {
  id: string;
  site: string;
  name: string;
  effective_from: string;
  effective_until: string;
  rate_per_kl_minor: number;
  standing_charge_minor: number;
  minimum_charge_minor: number;
  tax_bps: number;
  status: 'active' | 'retired' | '';
}

export interface MeterDevice {
  id: string;
  site: string;
  unit: string;
  imei: string;
  sn: string;
  name: string;
  model: string;
  valve_capable: boolean;
  valve_state: 'unknown' | 'open' | 'closed' | '';
  reporting_interval_s: number;
  last_uplink_at: string;
  last_reading_ml: number;
  last_reading_at: string;
  status: string;
  /** Present when fetched with `expand: 'unit'` (listMeters). */
  expand?: { unit?: { code?: string; name?: string } };
}

export interface MeterCommand {
  id: string;
  meter: string;
  type: string;
  status: 'queued' | 'sent' | 'acked' | 'failed' | 'expired' | '';
  queued_by: string;
  queued_role: string;
  sent_at: string;
  acked_at: string;
  error: string;
  created: string;
}

export interface MeterSighting {
  id: string;
  imei: string;
  sn: string;
  source_ip: string;
  first_seen: string;
  last_seen: string;
  status: 'unclaimed' | 'claimed' | 'ignored' | '';
}

export interface MeterEvent {
  id: string;
  site: string;
  meter: string;
  type: string;
  severity: 'info' | 'warning' | 'critical' | '';
  message: string;
  occurred_at: string;
}

export interface BillingCycle {
  id: string;
  site: string;
  period_start: string;
  period_end: string;
  due_date: string;
  status: 'open' | 'prepared' | 'issued' | 'closed' | '';
}

export interface Invoice {
  id: string;
  site: string;
  tenant_account: string;
  cycle: string;
  invoice_number: string;
  currency: string;
  subtotal_minor: number;
  tax_minor: number;
  total_minor: number;
  allocated_minor: number;
  status: 'draft' | 'issued' | 'partially_paid' | 'paid' | 'overdue' | 'disputed' | 'written_off' | '';
  issued_at: string;
  due_date: string;
}

export interface InvoiceLine {
  id: string;
  invoice: string;
  type: 'usage' | 'standing_charge' | 'minimum_charge' | 'tax' | 'credit' | 'correction' | '';
  description: string;
  quantity_ml: number;
  unit_price_minor: number;
  amount_minor: number;
  quality: 'actual' | 'estimated' | '';
}

export interface PaymentAllocation {
  id: string;
  invoice: string;
  amount_minor: number;
}

export interface PaymentResult {
  id: string;
  processing_status: string;
  allocations: PaymentAllocation[];
}

const API = '/api/farmon/billing';

/**
 * BillingService — the data layer for the site tenant-billing section: master
 * data (units / tenants / occupancies / settings / tariffs) as normal PocketBase
 * CRUD, and the financial + meter surfaces through the custom
 * /api/farmon/billing routes (money mutations are server-side only).
 */
@Injectable({ providedIn: 'root' })
export class BillingService {
  private backend = inject(BackendService);
  private get pb() {
    return this.backend.pb;
  }

  // --- Capability probe ------------------------------------------------------

  /** Whether the tenant_billing capability is granted for this site. */
  async capability(siteId: string): Promise<boolean> {
    const r = await this.pb.send<{ tenant_billing?: boolean }>(
      `${API}/capability?site=${encodeURIComponent(siteId)}`,
      { method: 'GET', requestKey: `billing:capability:${siteId}` },
    );
    return !!r.tenant_billing;
  }

  // --- Master data (owner CRUD; delete is admin-only server-side) ------------

  async listUnits(siteId: string): Promise<BillingUnit[]> {
    return this.pb.collection('billing_units').getFullList<BillingUnit>({
      filter: this.pb.filter('site = {:s}', { s: siteId }),
      sort: 'code',
      requestKey: `billing:units:${siteId}`,
    });
  }

  async createUnit(siteId: string, row: { code: string; name: string; status: string }): Promise<void> {
    await this.pb.collection('billing_units').create({ site: siteId, ...row });
  }

  async updateUnit(id: string, patch: { code: string; name: string; status: string }): Promise<void> {
    await this.pb.collection('billing_units').update(id, patch);
  }

  async deleteUnit(id: string): Promise<void> {
    await this.pb.collection('billing_units').delete(id);
  }

  async listTenants(siteId: string): Promise<TenantAccount[]> {
    return this.pb.collection('tenant_accounts').getFullList<TenantAccount>({
      filter: this.pb.filter('site = {:s}', { s: siteId }),
      sort: 'name',
      requestKey: `billing:tenants:${siteId}`,
    });
  }

  async createTenant(
    siteId: string,
    row: { account_number: string; name: string; phone: string; email: string; notes: string },
  ): Promise<void> {
    await this.pb.collection('tenant_accounts').create({ site: siteId, status: 'active', ...row });
  }

  async updateTenant(
    id: string,
    patch: { account_number: string; name: string; phone: string; email: string; status: string; notes: string },
  ): Promise<void> {
    await this.pb.collection('tenant_accounts').update(id, patch);
  }

  async deleteTenant(id: string): Promise<void> {
    await this.pb.collection('tenant_accounts').delete(id);
  }

  async listOccupancies(siteId: string): Promise<Occupancy[]> {
    return this.pb.collection('occupancies').getFullList<Occupancy>({
      filter: this.pb.filter('site = {:s}', { s: siteId }),
      sort: '-created',
      requestKey: `billing:occupancies:${siteId}`,
    });
  }

  async createOccupancy(
    siteId: string,
    row: { unit: string; tenant_account: string; liable_from: string; move_in_reading_ml?: number },
  ): Promise<void> {
    await this.pb.collection('occupancies').create({ site: siteId, status: 'active', ...row });
  }

  /** End an occupancy: stamps liable_until + flips status to ended. */
  async endOccupancy(id: string, moveOutReadingMl?: number): Promise<void> {
    await this.pb.collection('occupancies').update(id, {
      status: 'ended',
      liable_until: new Date().toISOString(),
      ...(moveOutReadingMl !== undefined ? { move_out_reading_ml: moveOutReadingMl } : {}),
    });
  }

  // --- Settings + tariffs -----------------------------------------------------

  /** The site's billing_settings row, or null when none has been saved yet. */
  async loadSettings(siteId: string): Promise<BillingSettings | null> {
    try {
      return await this.pb
        .collection('billing_settings')
        .getFirstListItem<BillingSettings>(this.pb.filter('site = {:s}', { s: siteId }), {
          requestKey: `billing:settings:${siteId}`,
        });
    } catch {
      return null; // 404 → not configured yet
    }
  }

  /** Create-if-missing save for the one-row-per-site settings record. */
  async saveSettings(siteId: string, s: Omit<BillingSettings, 'id' | 'site'>): Promise<void> {
    const existing = await this.loadSettings(siteId);
    if (existing) {
      await this.pb.collection('billing_settings').update(existing.id, s);
    } else {
      await this.pb.collection('billing_settings').create({ site: siteId, ...s });
    }
  }

  async listTariffs(siteId: string): Promise<Tariff[]> {
    return this.pb.collection('tariffs').getFullList<Tariff>({
      filter: this.pb.filter('site = {:s}', { s: siteId }),
      sort: '-effective_from',
      requestKey: `billing:tariffs:${siteId}`,
    });
  }

  async createTariff(
    siteId: string,
    row: Omit<Tariff, 'id' | 'site'>,
  ): Promise<void> {
    await this.pb.collection('tariffs').create({ site: siteId, ...row });
  }

  async updateTariff(id: string, patch: Omit<Tariff, 'id' | 'site'>): Promise<void> {
    await this.pb.collection('tariffs').update(id, patch);
  }

  async deleteTariff(id: string): Promise<void> {
    await this.pb.collection('tariffs').delete(id);
  }

  // --- Meters -----------------------------------------------------------------

  /** Site meters, with the unit relation expanded for the unit-code column. */
  async listMeters(siteId: string): Promise<MeterDevice[]> {
    return this.pb.collection('meter_devices').getFullList<MeterDevice>({
      filter: this.pb.filter('site = {:s}', { s: siteId }),
      sort: 'name,imei',
      expand: 'unit',
      requestKey: `billing:meters:${siteId}`,
    });
  }

  /** Claim a meter (usually from a sighting) to this site. Idempotent on IMEI. */
  async claimMeter(siteId: string, imei: string, name: string, unit: string): Promise<MeterDevice> {
    return this.pb.send<MeterDevice>(`${API}/meters/claim`, {
      method: 'POST',
      requestKey: null,
      body: { site: siteId, imei, name, ...(unit ? { unit } : {}) },
    });
  }

  /** Queue a valve command. The typed confirmation is enforced server-side too. */
  async meterValve(meterId: string, action: 'open' | 'close'): Promise<{ id: string; status: string }> {
    return this.pb.send<{ id: string; status: string }>(`${API}/meters/${meterId}/valve`, {
      method: 'POST',
      requestKey: null,
      body: { action, confirm: action.toUpperCase() },
    });
  }

  /** The meter's 50 most recent downlink commands (audit). */
  async meterCommands(meterId: string): Promise<MeterCommand[]> {
    const r = await this.pb.send<{ commands?: MeterCommand[] }>(`${API}/meters/${meterId}/commands`, {
      method: 'GET',
      requestKey: `billing:meter-commands:${meterId}`,
    });
    return r.commands ?? [];
  }

  /** Unclaimed devices that phoned home. Admin-only collection. */
  async listSightings(): Promise<MeterSighting[]> {
    return this.pb.collection('meter_sightings').getFullList<MeterSighting>({
      sort: '-last_seen',
      requestKey: 'billing:sightings',
    });
  }

  /** Recent meter health/security events for the overview feed. */
  async listMeterEvents(siteId: string, limit = 10): Promise<MeterEvent[]> {
    return this.pb.collection('meter_events').getList<MeterEvent>(1, limit, {
      filter: this.pb.filter('site = {:s}', { s: siteId }),
      sort: '-created',
      requestKey: `billing:meter-events:${siteId}`,
    }).then((r) => r.items);
  }

  // --- Cycles, invoices, payments ---------------------------------------------

  async listCycles(siteId: string): Promise<BillingCycle[]> {
    return this.pb.collection('billing_cycles').getFullList<BillingCycle>({
      filter: this.pb.filter('site = {:s}', { s: siteId }),
      sort: '-period_start',
      requestKey: `billing:cycles:${siteId}`,
    });
  }

  /** Issue a prepared cycle (flips its draft invoices to issued). Idempotent. */
  async issueCycle(cycleId: string): Promise<{ status: string; issued: number }> {
    return this.pb.send<{ status: string; issued: number }>(`${API}/cycles/${cycleId}/issue`, {
      method: 'POST',
      requestKey: null,
    });
  }

  /** Invoices for the site, optionally narrowed to one cycle. */
  async listInvoices(siteId: string, cycleId?: string): Promise<Invoice[]> {
    return this.pb.collection('invoices').getFullList<Invoice>({
      filter: this.pb.filter(
        cycleId ? 'site = {:s} && cycle = {:c}' : 'site = {:s}',
        cycleId ? { s: siteId, c: cycleId } : { s: siteId },
      ),
      sort: '-created',
      requestKey: `billing:invoices:${siteId}:${cycleId ?? 'all'}`,
    });
  }

  /** Outstanding invoices across the site (for the overview debt roll-up). */
  async listOutstanding(siteId: string): Promise<Invoice[]> {
    return this.pb.collection('invoices').getFullList<Invoice>({
      filter: this.pb.filter(
        "site = {:s} && (status = 'issued' || status = 'partially_paid' || status = 'overdue')",
        { s: siteId },
      ),
      requestKey: `billing:outstanding:${siteId}`,
    });
  }

  async invoiceLines(invoiceId: string): Promise<InvoiceLine[]> {
    return this.pb.collection('invoice_lines').getFullList<InvoiceLine>({
      filter: this.pb.filter('invoice = {:i}', { i: invoiceId }),
      sort: 'created',
      requestKey: `billing:invoice-lines:${invoiceId}`,
    });
  }

  /** Record a manual (cash/bank) payment; the server allocates oldest-debt-first. */
  async recordPayment(
    siteId: string,
    input: { tenant_account: string; amount_minor: number; payer_phone: string; reference: string },
  ): Promise<PaymentResult> {
    return this.pb.send<PaymentResult>(`${API}/payments/manual`, {
      method: 'POST',
      requestKey: null,
      body: { site: siteId, ...input },
    });
  }
}
