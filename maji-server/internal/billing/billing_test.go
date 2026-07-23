package billing

import (
	"testing"
	"time"

	_ "github.com/kisinga/majiflow/migrations"
	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tests"
)

func newTestApp(t *testing.T) *tests.TestApp {
	t.Helper()
	app, err := tests.NewTestApp()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(app.Cleanup)
	return app
}

func save(t *testing.T, app core.App, coll string, fields map[string]any) *core.Record {
	t.Helper()
	c, err := app.FindCollectionByNameOrId(coll)
	if err != nil {
		t.Fatal(err)
	}
	rec := core.NewRecord(c)
	for k, v := range fields {
		rec.Set(k, v)
	}
	if err := app.Save(rec); err != nil {
		t.Fatalf("save %s: %v", coll, err)
	}
	return rec
}

// seedAccount builds the minimal billing graph: site (tenant_billing addon),
// unit, tenant, active occupancy, and a valve-capable meter on the unit.
func seedAccount(t *testing.T, app core.App) (site, unit, tenant, meter *core.Record) {
	t.Helper()
	site = save(t, app, "sites", map[string]any{
		"name":   "Billing Site",
		"addons": []string{CapabilityTenantBilling},
	})
	unit = save(t, app, "billing_units", map[string]any{
		"site": site.Id, "code": "A1", "status": "active",
	})
	tenant = save(t, app, "tenant_accounts", map[string]any{
		"site": site.Id, "account_number": "ACC-001", "name": "Jane Tenant",
		"phone": "0712345678", "email": "jane@example.com", "status": "active",
	})
	save(t, app, "occupancies", map[string]any{
		"site": site.Id, "unit": unit.Id, "tenant_account": tenant.Id,
		"liable_from": time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC), "status": "active",
	})
	meter = save(t, app, "meter_devices", map[string]any{
		"site": site.Id, "unit": unit.Id, "imei": "867724031700001", "sn": "sn-1",
		"valve_capable": true, "valve_state": "open", "status": "active",
	})
	return site, unit, tenant, meter
}

func seedSettings(t *testing.T, app core.App, siteID string, grace, warn int, autoValve bool) *core.Record {
	t.Helper()
	return save(t, app, "billing_settings", map[string]any{
		"site": siteID, "timezone": "Africa/Nairobi", "due_day": 15,
		"grace_days": grace, "warn_days": warn, "auto_valve_enabled": autoValve,
		"currency": "KES",
	})
}

// june2026 are the June 2026 period bounds in Africa/Nairobi, as UTC.
func june2026() (start, end time.Time) {
	return time.Date(2026, 5, 31, 21, 0, 0, 0, time.UTC),
		time.Date(2026, 6, 30, 20, 59, 59, 0, time.UTC)
}

func seedCycle(t *testing.T, app core.App, siteID string, start, end, due time.Time, status string) *core.Record {
	t.Helper()
	return save(t, app, "billing_cycles", map[string]any{
		"site": siteID, "period_start": start, "period_end": end,
		"due_date": due, "status": status,
	})
}

func seedReading(t *testing.T, app core.App, siteID, meterID string, ml int64, msgID int, ts time.Time) {
	t.Helper()
	save(t, app, "meter_readings", map[string]any{
		"site": siteID, "meter": meterID, "device_ts": ts, "received_at": ts,
		"cumulative_ml": ml, "message_id": msgID,
	})
}

func findInvoice(t *testing.T, app core.App, cycleID string) *core.Record {
	t.Helper()
	inv, err := app.FindFirstRecordByFilter("invoices", "cycle = {:c}", dbx.Params{"c": cycleID})
	if err != nil || inv == nil {
		t.Fatalf("invoice for cycle %s not found: %v", cycleID, err)
	}
	return inv
}

func findLine(t *testing.T, app core.App, invoiceID, typ string) *core.Record {
	t.Helper()
	ln, err := app.FindFirstRecordByFilter("invoice_lines",
		"invoice = {:i} && type = {:t}", dbx.Params{"i": invoiceID, "t": typ})
	if err != nil || ln == nil {
		t.Fatalf("line %s for invoice %s not found: %v", typ, invoiceID, err)
	}
	return ln
}

func countRecords(t *testing.T, app core.App, coll, filter string, params dbx.Params) int {
	t.Helper()
	recs, err := app.FindRecordsByFilter(coll, filter, "", 0, 0, params)
	if err != nil {
		t.Fatal(err)
	}
	return len(recs)
}

// Invoice preparation: boundary readings → draft invoice with copied tariff
// values; idempotent on rerun.
func TestPrepareInvoices(t *testing.T) {
	app := newTestApp(t)
	site, _, tenant, meter := seedAccount(t, app)
	settings := seedSettings(t, app, site.Id, 7, 3, false)
	save(t, app, "tariffs", map[string]any{
		"site": site.Id, "name": "Standard 2026", "status": "active",
		"effective_from":    time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC),
		"rate_per_kl_minor": 50000, "tax_bps": 1600,
	})
	start, end := june2026()
	cycle := seedCycle(t, app, site.Id, start, end, time.Date(2026, 7, 15, 0, 0, 0, 0, time.UTC), "open")
	seedReading(t, app, site.Id, meter.Id, 1_000_000, 101, time.Date(2026, 5, 30, 10, 0, 0, 0, time.UTC))
	seedReading(t, app, site.Id, meter.Id, 3_500_000, 102, time.Date(2026, 6, 28, 10, 0, 0, 0, time.UTC))

	now := time.Date(2026, 7, 2, 10, 0, 0, 0, time.UTC)
	if err := prepareDueCycles(app, site, settings, now); err != nil {
		t.Fatal(err)
	}

	inv := findInvoice(t, app, cycle.Id)
	if got := inv.GetString("status"); got != "draft" {
		t.Errorf("invoice status = %q, want draft", got)
	}
	if got := inv.GetString("invoice_number"); got != "INV-202606-0001" {
		t.Errorf("invoice_number = %q, want INV-202606-0001", got)
	}
	// 2.5 kl @ 50000 minor/kl = 125000; tax 1600 bps = 20000; total 145000.
	if got := inv.GetInt("subtotal_minor"); got != 125000 {
		t.Errorf("subtotal = %d, want 125000", got)
	}
	if got := inv.GetInt("tax_minor"); got != 20000 {
		t.Errorf("tax = %d, want 20000", got)
	}
	if got := inv.GetInt("total_minor"); got != 145000 {
		t.Errorf("total = %d, want 145000", got)
	}
	if got := inv.GetString("tenant_account"); got != tenant.Id {
		t.Errorf("tenant = %q, want %q", got, tenant.Id)
	}
	if got := inv.GetString("currency"); got != "KES" {
		t.Errorf("currency = %q, want KES", got)
	}
	if got := inv.GetDateTime("due_date").Time(); !got.Equal(time.Date(2026, 7, 15, 0, 0, 0, 0, time.UTC)) {
		t.Errorf("due_date = %s, want 2026-07-15", got)
	}

	usage := findLine(t, app, inv.Id, "usage")
	if got := usage.GetInt("amount_minor"); got != 125000 {
		t.Errorf("usage amount = %d, want 125000", got)
	}
	if got := usage.GetInt("quantity_ml"); got != 2_500_000 {
		t.Errorf("usage quantity_ml = %d, want 2500000", got)
	}
	if got := usage.GetInt("unit_price_minor"); got != 50000 {
		t.Errorf("usage unit_price = %d, want 50000 (copied tariff rate)", got)
	}
	if got := usage.GetString("quality"); got != "actual" {
		t.Errorf("usage quality = %q, want actual", got)
	}
	if got := usage.GetString("meter"); got != meter.Id {
		t.Errorf("usage meter = %q, want %q", got, meter.Id)
	}
	if got := findLine(t, app, inv.Id, "tax").GetInt("amount_minor"); got != 20000 {
		t.Errorf("tax line = %d, want 20000", got)
	}

	cyc, err := app.FindRecordById("billing_cycles", cycle.Id)
	if err != nil {
		t.Fatal(err)
	}
	if got := cyc.GetString("status"); got != "prepared" {
		t.Errorf("cycle status = %q, want prepared", got)
	}

	// Rerun: the job-run key + unique (cycle, tenant) make it a no-op.
	if err := prepareDueCycles(app, site, settings, now.Add(time.Hour)); err != nil {
		t.Fatal(err)
	}
	if got := countRecords(t, app, "invoices", "cycle = {:c}", dbx.Params{"c": cycle.Id}); got != 1 {
		t.Fatalf("invoices after rerun = %d, want 1", got)
	}
}

// Missing boundary readings hold the occupancy for review: failed job run,
// no invoice, cycle stays open.
func TestPrepareInvoicesMissingReadings(t *testing.T) {
	app := newTestApp(t)
	site, _, _, _ := seedAccount(t, app)
	settings := seedSettings(t, app, site.Id, 7, 3, false)
	save(t, app, "tariffs", map[string]any{
		"site": site.Id, "name": "Standard 2026", "status": "active",
		"effective_from": time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC), "rate_per_kl_minor": 50000,
	})
	start, end := june2026()
	cycle := seedCycle(t, app, site.Id, start, end, time.Date(2026, 7, 15, 0, 0, 0, 0, time.UTC), "open")

	now := time.Date(2026, 7, 2, 10, 0, 0, 0, time.UTC)
	if err := prepareDueCycles(app, site, settings, now); err != nil {
		t.Fatal(err)
	}
	if got := countRecords(t, app, "invoices", "cycle = {:c}", dbx.Params{"c": cycle.Id}); got != 0 {
		t.Fatalf("invoices = %d, want 0 (missing readings)", got)
	}
	cyc, _ := app.FindRecordById("billing_cycles", cycle.Id)
	if got := cyc.GetString("status"); got != "open" {
		t.Errorf("cycle status = %q, want open (held for review)", got)
	}
	job, err := app.FindFirstRecordByFilter("billing_job_runs", "job_type = {:j}", dbx.Params{"j": jobPrepareInvoices})
	if err != nil || job == nil || job.GetString("status") != "failed" {
		t.Fatalf("expected a failed prepare job run, got %v (%v)", job, err)
	}
}

// Allocation: partial → paid → overpayment stays as credit on the payment.
func TestAllocatePayment(t *testing.T) {
	app := newTestApp(t)
	site, _, tenant, _ := seedAccount(t, app)
	start, end := june2026()
	cycle := seedCycle(t, app, site.Id, start, end, time.Date(2026, 7, 15, 0, 0, 0, 0, time.UTC), "issued")
	inv := save(t, app, "invoices", map[string]any{
		"site": site.Id, "tenant_account": tenant.Id, "cycle": cycle.Id,
		"invoice_number": "INV-202606-0001", "currency": "KES",
		"subtotal_minor": 100000, "total_minor": 100000, "allocated_minor": 0,
		"status": "issued", "due_date": time.Date(2026, 8, 1, 0, 0, 0, 0, time.UTC),
	})

	p1, allocs1, err := CreateManualPayment(app, site.Id, tenant.Id, 60000, "", "rcpt-1", "tester", "")
	if err != nil {
		t.Fatal(err)
	}
	if got := p1.GetString("processing_status"); got != "allocated" {
		t.Errorf("payment 1 status = %q, want allocated", got)
	}
	if len(allocs1) != 1 || allocs1[0].GetInt("amount_minor") != 60000 {
		t.Fatalf("payment 1 allocations = %+v, want one 60000", allocs1)
	}
	inv, _ = app.FindRecordById("invoices", inv.Id)
	if got := inv.GetString("status"); got != "partially_paid" {
		t.Errorf("after 60000: status = %q, want partially_paid", got)
	}
	if got := inv.GetInt("allocated_minor"); got != 60000 {
		t.Errorf("after 60000: allocated = %d, want 60000", got)
	}

	if _, _, err := CreateManualPayment(app, site.Id, tenant.Id, 40000, "", "rcpt-2", "tester", ""); err != nil {
		t.Fatal(err)
	}
	inv, _ = app.FindRecordById("invoices", inv.Id)
	if got := inv.GetString("status"); got != "paid" {
		t.Errorf("after 40000: status = %q, want paid", got)
	}
	if got := inv.GetInt("allocated_minor"); got != 100000 {
		t.Errorf("after 40000: allocated = %d, want 100000", got)
	}

	// Overpayment: no open invoices, so the full amount stays as credit.
	p3, allocs3, err := CreateManualPayment(app, site.Id, tenant.Id, 10000, "", "rcpt-3", "tester", "")
	if err != nil {
		t.Fatal(err)
	}
	if got := p3.GetString("processing_status"); got != "partially_allocated" {
		t.Errorf("overpayment status = %q, want partially_allocated", got)
	}
	if len(allocs3) != 0 {
		t.Errorf("overpayment allocations = %d, want 0", len(allocs3))
	}
	inv, _ = app.FindRecordById("invoices", inv.Id)
	if got := inv.GetInt("allocated_minor"); got != 100000 {
		t.Errorf("invoice touched by overpayment: allocated = %d, want 100000", got)
	}
}

// A client-supplied idempotency key makes a retried manual payment return the
// original booking instead of duplicating it.
func TestManualPaymentIdempotency(t *testing.T) {
	app := newTestApp(t)
	site, _, tenant, _ := seedAccount(t, app)
	start, end := june2026()
	cycle := seedCycle(t, app, site.Id, start, end, time.Date(2026, 7, 15, 0, 0, 0, 0, time.UTC), "issued")
	save(t, app, "invoices", map[string]any{
		"site": site.Id, "tenant_account": tenant.Id, "cycle": cycle.Id,
		"invoice_number": "INV-202606-0001", "currency": "KES",
		"total_minor": 50000, "status": "issued",
		"due_date": time.Date(2026, 8, 1, 0, 0, 0, 0, time.UTC),
	})

	p1, a1, err := CreateManualPayment(app, site.Id, tenant.Id, 50000, "", "rcpt-1", "tester", "web-req-abc123")
	if err != nil {
		t.Fatal(err)
	}
	// The retry: same key, same payload → the original payment, no new booking.
	p2, a2, err := CreateManualPayment(app, site.Id, tenant.Id, 50000, "", "rcpt-1", "tester", "web-req-abc123")
	if err != nil {
		t.Fatal(err)
	}
	if p2.Id != p1.Id {
		t.Errorf("retry returned payment %s, want original %s", p2.Id, p1.Id)
	}
	if len(a1) != 1 || len(a2) != 1 {
		t.Errorf("allocations = %d/%d, want 1/1", len(a1), len(a2))
	}
	if got := countRecords(t, app, "payment_transactions", "site = {:s}", dbx.Params{"s": site.Id}); got != 1 {
		t.Errorf("payments = %d, want 1 (retry deduped)", got)
	}
	if got := countRecords(t, app, "payment_allocations", "site = {:s}", dbx.Params{"s": site.Id}); got != 1 {
		t.Errorf("allocations = %d, want 1 (no double allocation)", got)
	}
}

// Arrears e2e: warn on the first sweep, close on a later one (never warn and
// close in the same pass), idempotent across sweeps, reopen after payment.
func TestArrearsEndToEnd(t *testing.T) {
	app := newTestApp(t)
	site, _, tenant, meter := seedAccount(t, app)
	seedSettings(t, app, site.Id, 0, 0, true) // grace 0, warn 0, auto-valve on
	start, end := june2026()
	cycle := seedCycle(t, app, site.Id, start, end, time.Date(2026, 7, 15, 0, 0, 0, 0, time.UTC), "issued")
	inv := save(t, app, "invoices", map[string]any{
		"site": site.Id, "tenant_account": tenant.Id, "cycle": cycle.Id,
		"invoice_number": "INV-202606-0001", "currency": "KES",
		"subtotal_minor": 100000, "total_minor": 100000, "allocated_minor": 0,
		"status": "overdue", "due_date": time.Date(2026, 7, 1, 0, 0, 0, 0, time.UTC),
	})

	countCmds := func(typ string) int {
		return countRecords(t, app, "meter_commands",
			"meter = {:m} && type = {:t}", dbx.Params{"m": meter.Id, "t": typ})
	}

	// Sweep 1: grace over → warning anchored, but no close in the same pass.
	now1 := time.Date(2026, 7, 10, 10, 0, 0, 0, time.UTC)
	RunArrearsSweep(app, now1)
	inv, _ = app.FindRecordById("invoices", inv.Id)
	if inv.GetDateTime("warned_at").IsZero() {
		t.Fatal("sweep 1: warned_at not set")
	}
	if got := countCmds("valve_close"); got != 0 {
		t.Fatalf("sweep 1 queued %d close commands, want 0 (warn first)", got)
	}

	// Sweep 2 (later day): warned + warn_days elapsed → close queued once.
	now2 := now1.Add(26 * time.Hour)
	RunArrearsSweep(app, now2)
	if got := countCmds("valve_close"); got != 1 {
		t.Fatalf("sweep 2 close commands = %d, want 1", got)
	}
	inv, _ = app.FindRecordById("invoices", inv.Id)
	if inv.GetDateTime("closed_at").IsZero() {
		t.Fatal("sweep 2: closed_at not set")
	}
	cmd, _ := app.FindFirstRecordByFilter("meter_commands", "meter = {:m} && type = 'valve_close'", dbx.Params{"m": meter.Id})
	if got := cmd.GetString("queued_by"); got != ArrearsRule {
		t.Errorf("close queued_by = %q, want %q", got, ArrearsRule)
	}

	// Sweep 3: nothing new (closed_at anchor + pending-valve guard).
	RunArrearsSweep(app, now2.Add(26*time.Hour))
	if got := countCmds("valve_close"); got != 1 {
		t.Fatalf("sweep 3 close commands = %d, want 1", got)
	}

	// The meter acked the close (its valve is now really shut)…
	cmd.Set("status", "acked")
	if err := app.Save(cmd); err != nil {
		t.Fatal(err)
	}
	meter.Set("valve_state", "closed")
	if err := app.Save(meter); err != nil {
		t.Fatal(err)
	}
	// …and the tenant pays in full → valve_open queued by the rule.
	if _, _, err := CreateManualPayment(app, site.Id, tenant.Id, 100000, "", "rcpt-9", "tester", ""); err != nil {
		t.Fatal(err)
	}
	inv, _ = app.FindRecordById("invoices", inv.Id)
	if got := inv.GetString("status"); got != "paid" {
		t.Fatalf("invoice status = %q, want paid", got)
	}
	if !inv.GetDateTime("closed_at").IsZero() {
		t.Error("closed_at not cleared after every meter reopened")
	}
	if got := countCmds("valve_open"); got != 1 {
		t.Fatalf("valve_open commands after payment = %d, want 1", got)
	}
	open, _ := app.FindFirstRecordByFilter("meter_commands", "meter = {:m} && type = 'valve_open'", dbx.Params{"m": meter.Id})
	if got := open.GetString("status"); got != "queued" {
		t.Errorf("valve_open status = %q, want queued", got)
	}
	if got := open.GetString("queued_by"); got != ArrearsRule {
		t.Errorf("valve_open queued_by = %q, want %q", got, ArrearsRule)
	}
}

// auto_valve_enabled off → the sweep neither warns nor closes.
func TestArrearsDisabled(t *testing.T) {
	app := newTestApp(t)
	site, _, tenant, meter := seedAccount(t, app)
	seedSettings(t, app, site.Id, 0, 0, false)
	start, end := june2026()
	cycle := seedCycle(t, app, site.Id, start, end, time.Date(2026, 7, 15, 0, 0, 0, 0, time.UTC), "issued")
	inv := save(t, app, "invoices", map[string]any{
		"site": site.Id, "tenant_account": tenant.Id, "cycle": cycle.Id,
		"invoice_number": "INV-202606-0001", "currency": "KES",
		"total_minor": 100000, "status": "overdue",
		"due_date": time.Date(2026, 7, 1, 0, 0, 0, 0, time.UTC),
	})

	RunArrearsSweep(app, time.Date(2026, 7, 10, 10, 0, 0, 0, time.UTC))
	inv, _ = app.FindRecordById("invoices", inv.Id)
	if !inv.GetDateTime("warned_at").IsZero() {
		t.Error("warned_at set despite auto_valve_enabled = false")
	}
	if got := countRecords(t, app, "meter_commands", "meter = {:m}", dbx.Params{"m": meter.Id}); got != 0 {
		t.Errorf("commands = %d, want 0", got)
	}
}

// Partial close recovery: with two meters on the account, a meter whose
// enqueue fails (here: not valve-capable at sweep time) does NOT block the
// other meter's closure, and a later sweep retries it once it becomes
// capable. closed_at records intent — set once and preserved across sweeps.
func TestArrearsPartialCloseRecovery(t *testing.T) {
	app := newTestApp(t)
	site, unit, tenant, meter1 := seedAccount(t, app)
	seedSettings(t, app, site.Id, 0, 0, true)
	meter2 := save(t, app, "meter_devices", map[string]any{
		"site": site.Id, "unit": unit.Id, "imei": "867724031700002", "sn": "sn-2",
		"valve_capable": false, "valve_state": "open", "status": "active",
	})
	start, end := june2026()
	cycle := seedCycle(t, app, site.Id, start, end, time.Date(2026, 7, 15, 0, 0, 0, 0, time.UTC), "issued")
	inv := save(t, app, "invoices", map[string]any{
		"site": site.Id, "tenant_account": tenant.Id, "cycle": cycle.Id,
		"invoice_number": "INV-202606-0001", "currency": "KES",
		"total_minor": 100000, "status": "overdue",
		"due_date": time.Date(2026, 7, 1, 0, 0, 0, 0, time.UTC),
	})
	countCmds := func(meterID, typ string) int {
		return countRecords(t, app, "meter_commands",
			"meter = {:m} && type = {:t}", dbx.Params{"m": meterID, "t": typ})
	}

	// Sweep 1: warn only.
	now1 := time.Date(2026, 7, 10, 10, 0, 0, 0, time.UTC)
	RunArrearsSweep(app, now1)

	// Sweep 2: meter1's close is queued; meter2's enqueue fails (not
	// valve-capable). closed_at is still set — intent recorded.
	now2 := now1.Add(26 * time.Hour)
	RunArrearsSweep(app, now2)
	if got := countCmds(meter1.Id, "valve_close"); got != 1 {
		t.Fatalf("sweep 2 meter1 close commands = %d, want 1", got)
	}
	if got := countCmds(meter2.Id, "valve_close"); got != 0 {
		t.Fatalf("sweep 2 meter2 close commands = %d, want 0 (enqueue failed)", got)
	}
	inv, _ = app.FindRecordById("invoices", inv.Id)
	closedAt := inv.GetDateTime("closed_at").Time()
	if closedAt.IsZero() {
		t.Fatal("sweep 2: closed_at not set despite meter1 closure queued")
	}

	// meter1 acked its close; meter2 is replaced with a valve-capable model.
	cmd1, _ := app.FindFirstRecordByFilter("meter_commands",
		"meter = {:m} && type = 'valve_close'", dbx.Params{"m": meter1.Id})
	cmd1.Set("status", "acked")
	if err := app.Save(cmd1); err != nil {
		t.Fatal(err)
	}
	meter1.Set("valve_state", "closed")
	if err := app.Save(meter1); err != nil {
		t.Fatal(err)
	}
	meter2.Set("valve_capable", true)
	if err := app.Save(meter2); err != nil {
		t.Fatal(err)
	}

	// Sweep 3: meter1 is closed (done); meter2 is retried and now queues.
	RunArrearsSweep(app, now2.Add(26*time.Hour))
	if got := countCmds(meter1.Id, "valve_close"); got != 1 {
		t.Fatalf("sweep 3 meter1 close commands = %d, want 1 (no duplicate)", got)
	}
	if got := countCmds(meter2.Id, "valve_close"); got != 1 {
		t.Fatalf("sweep 3 meter2 close commands = %d, want 1 (retried)", got)
	}
	inv, _ = app.FindRecordById("invoices", inv.Id)
	if got := inv.GetDateTime("closed_at").Time(); !got.Equal(closedAt) {
		t.Errorf("closed_at = %s, want preserved %s (set once)", got, closedAt)
	}

	// Sweep 4: meter2's command is in flight — nothing new, closed_at intact.
	RunArrearsSweep(app, now2.Add(50*time.Hour))
	if got := countCmds(meter2.Id, "valve_close"); got != 1 {
		t.Fatalf("sweep 4 meter2 close commands = %d, want 1 (in-flight guard)", got)
	}
	inv, _ = app.FindRecordById("invoices", inv.Id)
	if got := inv.GetDateTime("closed_at").Time(); !got.Equal(closedAt) {
		t.Errorf("closed_at = %s, want preserved %s", got, closedAt)
	}
}

// Reopen failure: every account meter must be reopened (or in flight) before
// closed_at is cleared. One meter failing the open-enqueue keeps closed_at so
// a later payment or manual action re-triggers the reopen.
func TestReopenPartialFailureKeepsClosedAt(t *testing.T) {
	app := newTestApp(t)
	site, unit, tenant, meter1 := seedAccount(t, app)
	seedSettings(t, app, site.Id, 0, 0, true)
	meter2 := save(t, app, "meter_devices", map[string]any{
		"site": site.Id, "unit": unit.Id, "imei": "867724031700002", "sn": "sn-2",
		"valve_capable": true, "valve_state": "open", "status": "active",
	})
	start, end := june2026()
	cycle := seedCycle(t, app, site.Id, start, end, time.Date(2026, 7, 15, 0, 0, 0, 0, time.UTC), "issued")
	inv := save(t, app, "invoices", map[string]any{
		"site": site.Id, "tenant_account": tenant.Id, "cycle": cycle.Id,
		"invoice_number": "INV-202606-0001", "currency": "KES",
		"total_minor": 100000, "status": "overdue",
		"due_date": time.Date(2026, 7, 1, 0, 0, 0, 0, time.UTC),
	})

	// Warn, then close both meters; both ack.
	now1 := time.Date(2026, 7, 10, 10, 0, 0, 0, time.UTC)
	RunArrearsSweep(app, now1)
	RunArrearsSweep(app, now1.Add(26*time.Hour))
	for _, m := range []*core.Record{meter1, meter2} {
		cmd, err := app.FindFirstRecordByFilter("meter_commands",
			"meter = {:m} && type = 'valve_close'", dbx.Params{"m": m.Id})
		if err != nil || cmd == nil {
			t.Fatalf("close command for meter %s not found: %v", m.Id, err)
		}
		cmd.Set("status", "acked")
		if err := app.Save(cmd); err != nil {
			t.Fatal(err)
		}
		m.Set("valve_state", "closed")
		if err := app.Save(m); err != nil {
			t.Fatal(err)
		}
	}
	inv, _ = app.FindRecordById("invoices", inv.Id)
	if inv.GetDateTime("closed_at").IsZero() {
		t.Fatal("closed_at not set after closing both meters")
	}

	// meter2 can no longer take valve commands (e.g. hardware fault reported
	// back, model re-registered as valve-less).
	meter2.Set("valve_capable", false)
	if err := app.Save(meter2); err != nil {
		t.Fatal(err)
	}

	// The tenant pays in full: meter1 reopens, meter2's enqueue fails →
	// closed_at must be kept.
	if _, _, err := CreateManualPayment(app, site.Id, tenant.Id, 100000, "", "rcpt-9", "tester", ""); err != nil {
		t.Fatal(err)
	}
	inv, _ = app.FindRecordById("invoices", inv.Id)
	if got := inv.GetString("status"); got != "paid" {
		t.Fatalf("invoice status = %q, want paid", got)
	}
	if inv.GetDateTime("closed_at").IsZero() {
		t.Error("closed_at cleared despite meter2 reopen failure")
	}
	if got := countRecords(t, app, "meter_commands",
		"meter = {:m} && type = 'valve_open'", dbx.Params{"m": meter1.Id}); got != 1 {
		t.Errorf("meter1 valve_open commands = %d, want 1", got)
	}
	if got := countRecords(t, app, "meter_commands",
		"meter = {:m} && type = 'valve_open'", dbx.Params{"m": meter2.Id}); got != 0 {
		t.Errorf("meter2 valve_open commands = %d, want 0 (enqueue failed)", got)
	}
}

// Settled before delivery: a queued-but-unsent valve_close is superseded by
// the payment — the sweep queued it, the tenant paid before the meter's next
// contact, so the close must be cancelled (not left to execute with
// closed_at cleared) and no open command is needed.
func TestReopenCancelsQueuedClose(t *testing.T) {
	app := newTestApp(t)
	site, _, tenant, meter1 := seedAccount(t, app)
	seedSettings(t, app, site.Id, 0, 0, true)
	start, end := june2026()
	cycle := seedCycle(t, app, site.Id, start, end, time.Date(2026, 7, 15, 0, 0, 0, 0, time.UTC), "issued")
	inv := save(t, app, "invoices", map[string]any{
		"site": site.Id, "tenant_account": tenant.Id, "cycle": cycle.Id,
		"invoice_number": "INV-202606-0001", "currency": "KES",
		"total_minor": 100000, "status": "overdue",
		"due_date": time.Date(2026, 7, 1, 0, 0, 0, 0, time.UTC),
	})

	now1 := time.Date(2026, 7, 10, 10, 0, 0, 0, time.UTC)
	RunArrearsSweep(app, now1)                   // warn
	RunArrearsSweep(app, now1.Add(26*time.Hour)) // close queued, not acked
	if got := countRecords(t, app, "meter_commands",
		"meter = {:m} && type = 'valve_close'", dbx.Params{"m": meter1.Id}); got != 1 {
		t.Fatalf("close commands = %d, want 1", got)
	}

	// The tenant pays in full before the meter's next contact.
	if _, _, err := CreateManualPayment(app, site.Id, tenant.Id, 100000, "", "rcpt-10", "tester", ""); err != nil {
		t.Fatal(err)
	}
	if got := countRecords(t, app, "meter_commands", "meter = {:m}", dbx.Params{"m": meter1.Id}); got != 0 {
		t.Errorf("commands after payment = %d, want 0 (queued close cancelled, no open needed)", got)
	}
	inv, _ = app.FindRecordById("invoices", inv.Id)
	if !inv.GetDateTime("closed_at").IsZero() {
		t.Error("closed_at not cleared after queued close was cancelled")
	}
}
