# MajiFlow Tenant Billing Module — Architecture

**Status:** proposed architecture  
**Target segment:** `property`  
**Capability key:** `tenant_billing`  
**Deployment:** MajiFlow cloud only for v1  
**Currency:** KES only for v1  

## 1. Purpose and scope

The tenant billing module turns cumulative readings from third-party NB-IoT/GSM water meters into auditable tenant invoices, accepts manual and M-Pesa payments, and delivers billing notifications through MajiFlow's existing communication infrastructure.

The module is a software layer in `maji-server` and the Angular dashboard. It does not modify MajiFlow field controllers or their firmware.

### In scope for v1

- Properties, units, tenant accounts, and occupancy history.
- Meter registration, installation history, and secure MQTT ingestion.
- Reading validation and operator review.
- Monthly postpaid billing in KES.
- Immutable invoices and line items.
- Manual payments, payment allocation, credits, and reversals.
- M-Pesa C2B and optional STK Push collection.
- Invoice, reminder, receipt, and meter-health notifications.
- Aging, collections, usage, and exception reporting.

### Out of scope for v1

- Prepaid metering and remote disconnection.
- Field pump or valve control.
- Meter hardware manufacturing.
- Multi-currency and full accounting.
- Tenant mobile application or authenticated tenant portal.
- MajiFlow SaaS subscription billing.
- Edge/on-prem billing deployments.

## 2. Existing MajiFlow integration points

MajiFlow currently provides:

- Go backend using PocketBase for persistence and authentication.
- Angular dashboard.
- Embedded Mochi MQTT broker.
- Broker-side device authentication, ACL enforcement, and publish ingestion hooks.
- Cloud and edge binaries with cloud-specific tenant integration.
- OpenWA WhatsApp delivery and email alert infrastructure.
- Multi-owner site authorization.
- `sites.segment`, `sites.packs`, and `sites.addons` commercial metadata.

Billing should follow these established seams:

- Backend package: `maji-server/internal/billing/`.
- Cloud registration: `maji-server/internal/tenant/` or a cloud-only registration point.
- HTTP routes: registered alongside existing custom API routes.
- MQTT ingestion: an extension of the embedded broker hooks, not a separate MQTT client subscriber.
- Notifications: a durable outbound-delivery abstraction with OpenWA and email adapters.

## 3. Architecture overview

```text
NB-IoT/GSM meter
        |
        | MQTT over TLS, device credentials
        v
Embedded Mochi broker
        |
        | authentication + ACL + OnPublish routing
        v
Billing ingest -----> readings / meter events / exception queue
        |                                |
        v                                v
Billing engine -----> invoices -----> outbound deliveries
        |                 |                  |
        |                 v                  +--> OpenWA / email
        |             account ledger
        |                 ^
        v                 |
M-Pesa adapter ------> payments and allocations
        |
        +--> C2B confirmation / validation
        +--> STK request / callback / status query

Angular dashboard --> authenticated billing command/query APIs
```

PocketBase remains the system of record. MQTT transports device data only; it is not used for browser or service-to-service workflows.

## 4. Domain model

All tenant-owned billing records carry a required `site` relation. Relations must cascade only where deletion is safe; financial records should normally be retained or archived rather than deleted.

### 4.1 Property and tenancy

| Collection | Purpose | Key fields |
|---|---|---|
| `billing_units` | Billable property units. | site, code, name, status |
| `tenant_accounts` | People or organizations responsible for bills. | site, account_number, name, phone, email, status, notes |
| `occupancies` | Historical liability for a unit. | site, unit, tenant_account, liable_from, liable_until, move_in_reading, move_out_reading, status |

Occupancy is temporal. A tenant must not be stored as mutable current state on a meter. Invoice generation resolves liability from `occupancies` for the billing period.

### 4.2 Metering

| Collection | Purpose | Key fields |
|---|---|---|
| `meter_devices` | MQTT identity and physical meter metadata. | site, meter_id, serial_number, model, status, token_hash, last_seen, battery_pct, signal_dbm |
| `meter_installations` | Historical placement of a meter. | site, meter, unit, installed_at, removed_at, opening_reading_ml, closing_reading_ml |
| `meter_readings` | Append-only cumulative readings. | site, meter, device_ts, received_at, cumulative_ml, flow_ml_min, battery_pct, signal_dbm, sequence, boot_id, quality, raw_payload |
| `meter_events` | Health, reset, tamper, and validation events. | site, meter, type, severity, message, occurred_at, resolved_at |

`meter_devices` is distinct from the existing `controllers` collection. Both are broker principals, but meters must not masquerade as field controllers.

### 4.3 Tariffs and billing

| Collection | Purpose | Key fields |
|---|---|---|
| `billing_settings` | Site billing policy and defaults. | site, timezone, due_day, reminder_days, estimation_policy, currency |
| `tariffs` | Versioned charge definitions. | site, name, effective_from, effective_until, rate_per_kl_minor, standing_charge_minor, minimum_charge_minor, tax_bps, status |
| `billing_cycles` | A site billing period. | site, period_start, period_end, due_date, status, generated_at |
| `invoices` | Immutable issued bill header. | site, tenant_account, cycle, invoice_number, currency, subtotal_minor, tax_minor, total_minor, status, issued_at, due_date |
| `invoice_lines` | Explainable invoice charges. | site, invoice, type, description, quantity_ml, unit_price_minor, amount_minor, meter, occupancy, quality |

An invoice may cover multiple meters or units. The association belongs on its line items rather than a singular `invoices.meter` field.

Tariff values used for an invoice must be copied onto its line items. Later tariff changes must not alter historical bills.

### 4.4 Payments and ledger

| Collection | Purpose | Key fields |
|---|---|---|
| `payment_transactions` | Immutable received-money events. | site, tenant_account, provider, provider_transaction_id, amount_minor, currency, payer_phone, reference, received_at, processing_status, raw_payload |
| `payment_allocations` | Applies a payment to one or more invoices. | site, payment, invoice, amount_minor, allocated_at, allocated_by, reversal_of |
| `account_ledger_entries` | Auditable account debits, credits, adjustments, and reversals. | site, tenant_account, type, debit_minor, credit_minor, currency, source_type, source_id, effective_at, reversal_of |

Invoice balance and tenant credit are derived from ledger entries and payment allocations. A payment is never made authoritative by toggling a `reconciled` boolean.

This model supports partial payments, one payment covering several invoices, overpayments, reallocation, corrections, refunds, and reversals.

### 4.5 Operations

| Collection | Purpose | Key fields |
|---|---|---|
| `billing_job_runs` | Scheduler audit and retry state. | site, job_type, business_key, status, attempt, started_at, finished_at, error |
| `billing_exceptions` | Items requiring operator review. | site, type, source_type, source_id, status, reason, assigned_to, resolved_at |
| `outbound_deliveries` | Durable notification attempts. | site, event_type, source_type, source_id, recipient, channel, template_version, idempotency_key, status, attempts, provider_message_id, last_error |

## 5. Data invariants

- Monetary values use integer minor units; no floating-point money.
- Meter totals use integer millilitres. Display conversions happen at the UI/report boundary.
- Financial and reading records are append-only after acceptance. Corrections use reversals or adjustment entries.
- Issued invoice contents are immutable.
- Every manual financial action records actor, time, reason, and correlation ID.
- Server and device timestamps are both retained.
- Site timezone controls billing dates; stored instants use UTC.
- Client-supplied totals, statuses, reconciliation flags, and entitlement values are never trusted.

Required unique constraints include:

```text
billing_cycles(site, period_start, period_end)
invoices(site, invoice_number)
invoices(cycle, tenant_account)
meter_readings(meter, boot_id, sequence)
payment_transactions(provider, provider_transaction_id)
billing_job_runs(job_type, business_key)
outbound_deliveries(idempotency_key)
```

## 6. MQTT protocol and ingestion

### 6.1 Authentication and topic namespace

Each meter receives a generated credential during registration. Only a password hash is stored. Credentials must support rotation and revocation.

Meter topics use the existing `majiflow` root and include the owning site:

```text
majiflow/{site_id}/meters/{meter_id}/telemetry
majiflow/{site_id}/meters/{meter_id}/status
majiflow/{site_id}/meters/{meter_id}/alert
```

The broker must:

1. Resolve the MQTT username to an active `meter_devices` record.
2. Verify the supplied token against `token_hash`.
3. Permit publishing only within that meter's stored site and meter namespace.
4. Reject meter subscriptions unless explicitly required by a future command protocol.
5. Route accepted publishes through the existing Mochi `OnPublish` hook.

### 6.2 Telemetry payload

```json
{
  "schema": 1,
  "device_ts": "2026-07-16T07:32:10Z",
  "boot_id": "01J2YQ6N6G",
  "sequence": 1234,
  "cumulative_ml": 12345600,
  "flow_ml_min": 12300,
  "battery_pct": 87,
  "signal_dbm": -65,
  "tamper": false
}
```

Payloads have an explicit schema version. `received_at` is assigned by the server.

### 6.3 Ingestion rules

1. Validate topic identity, schema version, field bounds, payload size, and timestamp tolerance.
2. Deduplicate using `meter + boot_id + sequence`. Devices without stable sequencing enter a vendor-specific adapter path; timestamp-only deduplication is not the default.
3. Preserve the accepted raw payload for diagnostics.
4. Treat late and out-of-order readings as history updates; never let them silently replace a billing close.
5. Detect resets or rollovers using vendor metadata, register limits, boot identity, and reading history. Do not rely on a fixed percentage heuristic.
6. Route unexplained negative deltas, implausible flow, clock drift, and missing boundary readings to `billing_exceptions`.
7. Update device health independently from accepted billable usage.
8. Create deduplicated meter events for tamper, low battery, and offline conditions.

## 7. Billing engine

### 7.1 Scheduler guarantees

Billing jobs run only in the cloud deployment. The scheduler may use PocketBase cron facilities or a repository-compatible worker, but the implementation must provide:

- Site-timezone scheduling.
- Idempotent business keys.
- Restart catch-up.
- At-most-one active run for each site, job, and period.
- Transactional state transitions.
- Bounded retries and operator-visible failures.
- Safety when multiple cloud instances are running.

Suggested jobs:

| Job | Schedule | Business key |
|---|---|---|
| `create_cycle` | Daily | `site + period` |
| `prepare_invoices` | After cycle end | `cycle` |
| `issue_approved_invoices` | Operator or policy driven | `cycle + issue revision` |
| `mark_overdue` | Daily per site timezone | `site + local date` |
| `queue_reminders` | Daily per site timezone | `invoice + reminder date` |
| `reconcile_payments` | Frequent | `payment transaction` |
| `query_pending_mpesa` | Frequent | `provider request ID` |
| `detect_meter_health` | Frequent | `meter + health episode` |

### 7.2 Invoice preparation

For every occupancy liable during a cycle:

1. Resolve meter installations overlapping the occupancy and cycle.
2. Resolve the tariff effective for each charge interval.
3. Select validated boundary readings using server-defined inclusive/exclusive period semantics.
4. Split usage at occupancy, installation, tariff, or meter-reset boundaries.
5. Calculate usage in integer units using explicit rounding rules.
6. Add usage, standing-charge, minimum-charge adjustment, tax, credit, or correction lines as applicable.
7. Record actual or estimated quality and the supporting readings on each usage line.
8. Create a draft invoice and ledger preview transactionally.
9. Route insufficient or contradictory data to manual review instead of issuing silently.

The original calculation must be reproducible from stored inputs.

### 7.3 Missing-reading policy

The site chooses one policy:

- `hold_for_review`: do not issue until a valid reading is supplied.
- `standing_charge_only`: issue non-usage charges and adjust later.
- `estimate`: estimate from a documented historical method and mark the line accordingly.

Using the last known cumulative reading as the closing reading is not considered an estimate. Subsequent actual readings create an adjustment; issued invoices are not rewritten.

### 7.4 Invoice lifecycle

```text
draft -> issued -> sent
issued/sent -> partially_paid -> paid
issued/sent/partially_paid -> overdue
issued/sent/overdue -> disputed
disputed -> issued | written_off
```

Only valid server-side transitions are permitted. `sent` is delivery state, not financial settlement; implementations may keep it as a separate delivery projection rather than an invoice status.

## 8. Payments and M-Pesa

### 8.1 Commercial ownership decision

Before implementation, choose one model:

1. A MajiFlow-controlled shortcode serving multiple sites, with site/account encoded in the payment reference; or
2. Per-site landlord shortcodes and credentials.

This determines onboarding, credential custody, routing, reconciliation, support, and compliance. Secrets must be held in server-side secret storage; never in owner-readable PocketBase fields.

### 8.2 Integration flows

M-Pesa is not represented by one generic webhook. Implement and test separately:

- C2B validation callback, if validation is enabled.
- C2B confirmation callback.
- STK Push initiation.
- STK asynchronous result callback.
- STK transaction-status query.
- Operator reconciliation for unmatched or conflicting transactions.

Public callbacks must use HTTPS, strict payload validation, rate limiting, provider transaction deduplication, source/network controls where supported, and secret callback paths or equivalent provider-supported controls. Do not assume a generic HMAC signature unless the selected Daraja product explicitly provides and documents it.

Callbacks should acknowledge promptly after durable persistence. Allocation and notifications happen asynchronously.

### 8.3 Reconciliation

Reconciliation order:

1. Exact invoice/account reference.
2. Exact outstanding amount where the account identity is already known.
3. Configured oldest-debt allocation within the known account.
4. Otherwise create an exception for operator review.

Phone number alone is not a safe account identity. Automatic cross-account matching is prohibited.

## 9. Notifications

Billing communication uses `outbound_deliveries`, with OpenWA and email as transport adapters. It must not directly reuse incident-only deduplication semantics from the alert sweeper.

Events include:

- Invoice issued.
- Payment reminder.
- Invoice overdue.
- Payment received and allocated.
- Payment received but unmatched.
- Meter offline, low battery, or tamper.

Each delivery has a stable idempotency key, retry state, last error, and provider message ID. Templates are versioned and rendered from immutable event data.

Billing notices go to the tenant contact recorded for the account. Operational meter alerts go to opted-in site owners. Consent, opt-out, quiet-hour, and fallback-channel policy must be defined before production launch.

## 10. API boundary

PocketBase CRUD may be used for safe master-data reads and guarded writes. Financial state transitions, meter registration, entitlements, and provider callbacks require custom server routes.

Suggested endpoints:

| Method | Endpoint | Purpose |
|---|---|---|
| `POST` | `/api/farmon/billing/meters/register` | Register a meter and issue its one-time credential. |
| `POST` | `/api/farmon/billing/meters/:id/rotate-token` | Rotate meter credentials. |
| `POST` | `/api/farmon/billing/cycles/:id/prepare` | Idempotently prepare draft invoices. |
| `POST` | `/api/farmon/billing/cycles/:id/issue` | Issue approved draft invoices. |
| `POST` | `/api/farmon/billing/invoices/:id/send` | Queue delivery; return `202 Accepted`. |
| `POST` | `/api/farmon/billing/invoices/:id/dispute` | Open a dispute with a reason. |
| `POST` | `/api/farmon/billing/payments/manual` | Record a manual payment transaction. |
| `POST` | `/api/farmon/billing/payments/:id/allocate` | Allocate or reallocate payment credit. |
| `POST` | `/api/farmon/billing/payments/:id/reverse` | Create an auditable reversal. |
| `POST` | `/api/farmon/billing/mpesa/stk` | Initiate an idempotent STK request. |
| `POST` | `/api/farmon/billing/mpesa/c2b/validation/{secret}` | Public C2B validation callback. |
| `POST` | `/api/farmon/billing/mpesa/c2b/confirmation/{secret}` | Public C2B confirmation callback. |
| `POST` | `/api/farmon/billing/mpesa/stk/callback/{secret}` | Public STK result callback. |
| `GET` | `/api/farmon/billing/invoices/:id/pdf` | Generate or retrieve an invoice PDF. |
| `GET` | `/api/farmon/billing/accounts/:id/statement` | Retrieve an account statement. |
| `GET` | `/api/farmon/billing/reports/{report}` | Aging, collection, usage, or exceptions. |

Authenticated commands derive site authorization from the target record. They do not trust a caller-supplied site ID. Idempotency keys are required for STK initiation and financial commands that may be retried.

There is no `mark-paid` endpoint. Settlement must result from a payment transaction and allocation.

## 11. Authorization and entitlements

### 11.1 Site authorization

PocketBase rules must follow the repository's multi-owner relation semantics and include partner access where appropriate. Conceptually:

```text
authenticated AND (
  admin
  OR site.owner contains auth user
  OR authorized site partner
)
```

Tenant contacts never receive direct PocketBase collection access in v1.

### 11.2 Capability gating

`tenant_billing` is a capability granted by an admin-controlled pack or addon. Before billing routes rely on it:

- Owners must be prevented from self-granting entitlement fields.
- One backend capability evaluator must combine core, pack, and addon grants.
- Custom routes and billing collection rules must enforce the capability.
- Frontend route hiding is convenience only, not security.
- Background jobs must skip sites without the capability.

The `property` segment controls positioning and defaults, not authorization. A correctly entitled non-property site may use the module if commercial policy permits it.

## 12. Frontend

The Angular dashboard adds a `/billing` section, visible only when the backend-resolved capability set contains `tenant_billing`.

| Route | Purpose |
|---|---|
| `/billing` | Outstanding balance, collections, exceptions, and meter health. |
| `/billing/units` | Units and occupancy history. |
| `/billing/tenants` | Tenant accounts and statements. |
| `/billing/meters` | Meter registration, installation, health, and reading review. |
| `/billing/cycles` | Cycle preparation, exception review, approval, and issue. |
| `/billing/invoices` | Invoice search, detail, dispute, PDF, and delivery status. |
| `/billing/payments` | Transactions, unmatched payments, allocations, and reversals. |
| `/billing/reports` | Aging, collections, usage, and operational exceptions. |
| `/billing/settings` | Timezone, tariff, due dates, estimation, reminders, and M-Pesa setup status. |

High-risk actions require confirmation, a reason, and clear success/failure state. The UI must expose exceptions and failed deliveries rather than presenting automation as silently successful.

## 13. PDFs and exports

Invoice PDFs are derived artifacts generated from immutable invoice data. Store either:

- The rendered PDF on the invoice with a content/version hash; or
- A reproducible generated response with stable template versioning.

Templates include site identity, tenant account, billed units/meters, period, reading quality, line items, totals, payment instructions, and invoice number.

CSV export is required for reports and accounting handoff. QuickBooks or other accounting integrations remain out of scope.

## 14. Operational requirements

- Structured logs with site, job, invoice, payment, meter, and correlation IDs.
- Metrics for ingestion lag, rejected readings, job failures, invoice exceptions, unmatched payments, callback failures, and notification delivery failures.
- Health checks must distinguish HTTP, database, broker, scheduler, OpenWA, email, and M-Pesa readiness.
- Database and file-storage backup/restore procedures must be tested before production billing.
- Sensitive payloads and contact data must be redacted from ordinary logs.
- Raw payment callback retention and personal-data retention periods must be defined.
- Administrative access and financial mutations must be auditable.

## 15. Testing and acceptance gates

### Automated tests

- Broker authentication and cross-site ACL denial.
- Payload validation, deduplication, ordering, reset, and rollover cases.
- Occupancy, installation, and tariff boundary splitting.
- Integer rounding and minimum-charge calculations.
- Missing-reading policies and later adjustments.
- Job idempotency, crash recovery, and concurrent execution.
- Invoice immutability and lifecycle transitions.
- Partial, multi-invoice, overpayment, reversal, and reallocation behavior.
- Duplicate and out-of-order M-Pesa callbacks.
- Site isolation, partner permissions, and entitlement enforcement.
- Notification idempotency and retry behavior.

### Production-readiness gates

- Selected meter tested end-to-end against the embedded broker over TLS.
- Daraja sandbox tests cover C2B/STK success, failure, duplicate, timeout, and status query.
- A complete billing cycle can be reproduced from readings and tariff snapshots.
- Operators can resolve missing readings and unmatched payments without database access.
- Restore exercise proves invoices, ledger, callbacks, and PDFs survive backup recovery.
- Legal and tax treatment, invoice wording, consent, and data-retention policy are confirmed.

## 16. Delivery plan

### Phase 0 — decisions and vendor proof

- Select meter vendor and prove MQTT authentication, topic control, sequencing, and reset behavior.
- Choose the M-Pesa shortcode ownership model.
- Confirm tax, invoicing, consent, retention, and estimation policy.
- Lock v1 operational volumes and service-level expectations.

### Phase 1 — domain and entitlement foundation

- Collections, indexes, migrations, authorization rules, and capability evaluator.
- Units, tenant accounts, occupancies, installations, tariffs, and settings UI.
- Audit and exception foundations.

### Phase 2 — secure metering

- Meter registration and credential rotation.
- Broker principal/ACL extension and ingest routing.
- Reading validation, health events, and operator review.

### Phase 3 — invoicing

- Idempotent scheduler and job audit.
- Cycle preparation, calculation engine, exception workflow, approval, and issue.
- Invoice lines, ledger postings, PDFs, and CSV exports.

### Phase 4 — manual collections and delivery

- Manual payment transactions, allocations, credits, reversals, and statements.
- Durable outbound deliveries using OpenWA/email adapters.

### Phase 5 — M-Pesa

- C2B and/or STK flows selected in Phase 0.
- Durable callbacks, reconciliation, status queries, and exception handling.

### Phase 6 — reporting and hardening

- Aging, collections, usage, and operations reports.
- Metrics, health checks, backup/restore exercise, load tests, and production runbook.

Do not commit to an eight-week production launch until Phase 0 validates the meter and M-Pesa operating models. A pilot may use manual invoice approval and reconciliation while automation is proven.

## 17. Decisions required before implementation

1. Which meter vendor and protocol variant will be supported first?
2. Will MajiFlow or each landlord own the receiving shortcode?
3. Is the first collection flow C2B PayBill, STK Push, or both?
4. Is invoice issue automatic, or operator-approved during the pilot?
5. Which missing-reading policy is allowed, and how are estimates calculated?
6. Are standing charges, minimum charges, tax, and proration legally and commercially required?
7. What are the expected meters per site, readings per day, invoices per month, and retention period?
8. Which roles may issue invoices, reverse payments, write off debt, and resolve disputes?
9. What tenant consent and opt-out rules apply to WhatsApp and email billing notices?
10. When does a failed external delivery require operator escalation?

