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
  /** Sends per downlink command before it fails and the owners are alerted (0/unset = 3). */
  cmd_max_attempts: number;
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
  /** Set by the arrears automation when the tenant is warned (migration 59). */
  warned_at: string;
  /** Set by the arrears automation when the valve is closed for arrears (migration 59). */
  closed_at: string;
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

/** One allocation line in the /payments/manual response (NOT the collection). */
export interface PaymentAllocationResult {
  id: string;
  invoice: string;
  amount_minor: number;
}

export interface PaymentResult {
  id: string;
  processing_status: string;
  allocations: PaymentAllocationResult[];
}

export interface InvoicePage {
  items: Invoice[];
  totalItems: number;
}

/** Client-side status chips mapped to invoice-status filters ('unpaid' = issued + partially_paid). */
export type InvoiceStatusFilter = 'all' | 'unpaid' | 'overdue' | 'paid';

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
  async endOccupancy(id: string): Promise<void> {
    await this.pb.collection('occupancies').update(id, {
      status: 'ended',
      liable_until: new Date().toISOString(),
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

  /**
   * Queue a valve command. `confirm` is the operator's typed confirmation,
   * sent verbatim — the server requires it to equal the uppercased action.
   */
  async meterValve(meterId: string, action: 'open' | 'close', confirm: string): Promise<{ id: string; status: string }> {
    return this.pb.send<{ id: string; status: string }>(`${API}/meters/${meterId}/valve`, {
      method: 'POST',
      requestKey: null,
      body: { action, confirm },
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

  /** Downlink commands awaiting meter contact (queued or sent), site-wide. */
  async listPendingValveCommands(siteId: string): Promise<MeterCommand[]> {
    return this.pb.collection('meter_commands').getFullList<MeterCommand>({
      filter: this.pb.filter("site = {:s} && (status = 'queued' || status = 'sent')", { s: siteId }),
      sort: '-created',
      requestKey: `billing:pending-commands:${siteId}`,
    });
  }

  /** Count of downlink commands awaiting meter contact (nav badge). */
  async countPendingValveCommands(siteId: string): Promise<number> {
    const r = await this.pb.collection('meter_commands').getList<MeterCommand>(1, 1, {
      filter: this.pb.filter("site = {:s} && (status = 'queued' || status = 'sent')", { s: siteId }),
      requestKey: `billing:pending-commands-count:${siteId}`,
    });
    return r.totalItems;
  }

  /** Failed/expired downlink commands in the last `days` (attention surface). */
  async countFailedValveCommands(siteId: string, days = 7): Promise<number> {
    const since = new Date(Date.now() - days * 86_400_000).toISOString();
    const r = await this.pb.collection('meter_commands').getList<MeterCommand>(1, 1, {
      filter: this.pb.filter(
        "site = {:s} && (status = 'failed' || status = 'expired') && created >= {:d}",
        { s: siteId, d: since },
      ),
      requestKey: `billing:failed-commands:${siteId}:${days}`,
    });
    return r.totalItems;
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

  /**
   * Invoices for the site, newest first, PAGED (getFullList was unbounded).
   * Cycle / account / status narrow server-side so paging stays correct.
   * requestKey is null: paged refetches (load-more, filter changes) must not
   * auto-cancel each other.
   */
  async listInvoices(
    siteId: string,
    opts: { cycleId?: string; accountId?: string; status?: InvoiceStatusFilter; page?: number; perPage?: number } = {},
  ): Promise<InvoicePage> {
    const { cycleId, accountId, status, page = 1, perPage = 100 } = opts;
    const clauses = ['site = {:s}'];
    const params: Record<string, string> = { s: siteId };
    if (cycleId) { clauses.push('cycle = {:c}'); params['c'] = cycleId; }
    if (accountId) { clauses.push('tenant_account = {:a}'); params['a'] = accountId; }
    if (status === 'unpaid') clauses.push("(status = 'issued' || status = 'partially_paid')");
    else if (status && status !== 'all') { clauses.push('status = {:st}'); params['st'] = status; }
    const r = await this.pb.collection('invoices').getList<Invoice>(page, perPage, {
      filter: this.pb.filter(clauses.join(' && '), params),
      sort: '-created',
      requestKey: null,
    });
    return { items: r.items, totalItems: r.totalItems };
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

  /** Overdue invoices only (shell nav badge count + attention banner total). */
  async listOverdueInvoices(siteId: string): Promise<Invoice[]> {
    return this.pb.collection('invoices').getFullList<Invoice>({
      filter: this.pb.filter("site = {:s} && status = 'overdue'", { s: siteId }),
      sort: '-created',
      requestKey: `billing:overdue:${siteId}`,
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
