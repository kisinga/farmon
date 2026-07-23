# M-Pesa Collection for Tenant Billing — Implementation Spec

**Status:** ready for implementation (one decision required first — §1)
**Companion docs:** `docs/billing-module-architecture.md` §8 (payments, authoritative on flows), `docs/billing-shengda-implementation-spec.md` (metering + billing spine, already built)
**Builds on:** `payment_transactions` / `payment_allocations` (migration 59), `internal/billing/payments.go`, `internal/alerts/notify.go`

## 0. What this is

Adds M-Pesa (Safaricom Daraja) as a payment provider for tenant billing. Two collection flows, both per architecture §8.2: **C2B** (tenant pays a PayBill/till number with their account number as reference) and **STK Push** (operator or tenant triggers a phone prompt). Manual payments already work; this adds the automated rails so money reconciles without operator data entry.

## 1. Decision required FIRST (architecture §8.1)

Shortcode ownership. Options:

- **A — MajiFlow shortcode, all sites.** One PayBill; the site/account is encoded in the payment reference (BillRefNumber = tenant `account_number`). One Daraja app, one credential set, one callback surface. Onboarding a site = zero M-Pesa paperwork.
- **B — Per-site landlord shortcodes.** Each landlord registers their own PayBill and hands over API credentials. Correct fund flow (money lands in the landlord's account directly) but per-site onboarding burden, per-site credential custody, per-site callback config.

**Recommendation: A for v1.** Funds land in a MajiFlow settlement account and are remitted per the commercial agreement; the ledger (`payment_allocations`) is already per-site exact. B can be added later as a per-site `mpesa_shortcode` override without schema change (config resolution order: site override → deployment default). **Confirm before any code.**

## 2. Config + secrets

Env-only (secrets never in owner-readable PocketBase fields — architecture §8.1):

```
MAJI_MPESA_ENV=sandbox|production
MAJI_MPESA_CONSUMER_KEY=…
MAJI_MPESA_CONSUMER_SECRET=…
MAJI_MPESA_SHORTCODE=174379          # sandbox default
MAJI_MPESA_PASSKEY=…                 # STK only
MAJI_MPESA_CALLBACK_SECRET=<random>  # path token on public callbacks
```

Empty `MAJI_MPESA_CONSUMER_KEY` = provider disabled: routes 503, reconciliation skips. New file `internal/billing/mpesa.go` reads env via the existing `config` pattern (extend `config.Config`).

## 3. Daraja client (`internal/billing/mpesa.go`)

- OAuth token fetch (`/oauth/v1/generate`), cached with expiry minus 60s skew, single-flight.
- `STKPush(app, siteID, tenantAccountID, phone, amountMinor, idempotencyKey)` → `lipa/na mpesa-online query` + `mpesa/stkpush/v1/processrequest`. Amount in whole KES (minor/100, integer division — reject non-whole amounts for STK; C2B has no such constraint).
- `STKStatusQuery(checkoutRequestID)` for the pending-poller job.
- Timeouts: 10s connect, 30s overall; no retries inside the client (idempotency lives at the job/route layer).

## 4. Data model additions (migration 60)

- `mpesa_requests`: site, tenant_account, type (`stk_push`), idempotency_key (unique), checkout_request_id, merchant_request_id, phone, amount_minor, status (`initiated|callback_received|completed|failed|timeout`), result_code, result_desc, raw_callback json, created/updated.
- `payment_transactions` reuse: provider `mpesa`, `provider_transaction_id` = M-Pesa receipt number (unique index already exists — this is the C2B/callback dedupe anchor), `raw_payload` = the callback verbatim.

No other schema change: allocation, invoice transitions, arrears reopen all flow through the existing `AllocatePayment`.

## 5. Flows

### 5.1 C2B (confirmation + optional validation)

Public endpoints (no auth; guarded by the path secret + payload validation + rate limit):

- `POST /api/farmon/billing/mpesa/c2b/validation/{secret}` — answer accept/reject: accept when the BillRefNumber resolves to a `tenant_accounts.account_number` within the deployment, else reject with a reason (this is what makes fat-fingered references fail at the till, not in reconciliation).
- `POST /api/farmon/billing/mpesa/c2b/confirmation/{secret}` — persist FIRST, ack fast:
  1. Validate payload shape; dedupe on `TransID` against `payment_transactions(provider='mpesa', provider_transaction_id)` — duplicate → 200 no-op.
  2. Insert `payment_transactions` (amount, phone, reference, received_at, raw_payload, processing_status unallocated).
  3. Resolve account: exact `account_number` match on BillRefNumber → `AllocatePayment` (oldest-debt within that account, per architecture §8.3). Phone number is NEVER an account identity; no cross-account matching.
  4. Unresolved → `processing_status` stays unallocated + a `meter_events`-style operator notice (reuse `billing_job_runs`-adjacent log + alerts email to site owners; a `billing_exceptions` queue is deferred with the reports phase).
  5. On allocation settling arrears: the existing `ReevaluateAfterPayment` fires valve_open automatically.

### 5.2 STK Push

- `POST /api/farmon/billing/mpesa/stk` (authed, requireSiteAccess + capability): body `{site, tenant_account, phone, amount_minor, idempotency_key}`. Insert `mpesa_requests` (idempotency_key unique — retry returns the existing request), call Daraja, store checkout/merchant IDs.
- `POST /api/farmon/billing/mpesa/stk/callback/{secret}`: match by `CheckoutRequestID`; result_code 0 → create `payment_transactions` (receipt number as provider_transaction_id; insert is idempotent on replays) + `AllocatePayment`; non-zero → mark failed with result_desc. Update `mpesa_requests` either way.
- Job `query_pending_mpesa` (scheduler, every 5 min): `initiated` requests older than 60s → STKStatusQuery; mark completed/failed/timeout (>10 min).

## 6. Security requirements (all testable)

- Callback URLs are unguessable (`MAJI_MPESA_CALLBACK_SECRET`, constant-time compare). Daraja does NOT sign callbacks — do not invent HMAC verification.
- Rate-limit public callback routes (per-IP, e.g. 30/min — Daraja retries are low-frequency; tighten from observed traffic).
- Payload validation before any DB write; reject unknown fields liberally (Safaricom adds fields), but require the ones we read.
- Ack within ~2s: persist + enqueue, never block on Daraja or SMTP in the callback path.
- Payer phone + raw payloads are PII: keep out of ordinary logs (architecture §14).

## 7. Dashboard additions (`site/:name/billing`)

- Invoices page: "Request STK push" action on issued/overdue invoices (prefills tenant phone + outstanding amount, whole-KES check).
- Payments page section: M-Pesa transactions with receipt numbers, unmatched/unallocated list with a "assign to account" operator action (creates the allocation, not the payment).
- Settings: M-Pesa connection status (from `/api/farmon/billing/mpesa/status` — env configured? last successful callback? — never the secrets themselves).

## 8. Testing + acceptance gates

1. Daraja client: recorded sandbox responses for token, STK success/fail/timeout, C2B confirm — no live network in tests (httptest server).
2. Callback dedupe: same TransID twice → one payment, one allocation set, 200 both times.
3. STK e2e (NewTestApp): push → callback → invoice paid → `ReevaluateAfterPayment` queues valve_open for an arrears-closed meter.
4. Unmatched C2B → unallocated payment + operator notice; operator assigns → allocation lands.
5. Validation endpoint rejects unknown account numbers, accepts known ones.
6. Rate limiter trips on flood; legit Daraja retry pattern passes.
7. `go test ./... -race` green; sandbox end-to-end against the real Daraja sandbox before production (architecture §15 gate).

## 9. Explicit unknowns — resolve during implementation

- Exact BillRefNumber format tenants will type (account_number is the plan; confirm the shortcode supports alpha in references — PayBill yes, till no).
- Whether the commercial model needs per-site settlement reporting before launch (finance question, not code).
- Daraja rate limits on status query — poller interval tuned from sandbox behavior.

## 10. Delivery order

1. §1 decision → 2. config + Daraja client → 3. migration 60 → 4. C2B pair → 5. STK trio + poller → 6. dashboard → 7. sandbox gates. C2B alone is deployable value; STK can lag by a release.
