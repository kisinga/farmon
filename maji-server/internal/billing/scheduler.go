package billing

import (
	"fmt"
	"log"
	"strings"
	"time"

	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tools/types"
)

// Billing scheduler (architecture §7.1, trimmed): one goroutine, per-site
// jobs with idempotent business keys audited in billing_job_runs. A unique
// (job_type, business_key) index makes a re-run after restart a no-op.
//
// Jobs: create_cycle (monthly, site timezone), prepare_invoices (usage from
// boundary readings × tariff), and a daily collections pass (mark_overdue +
// arrears sweep) keyed on the site's local date. Missing boundary readings
// hold the invoice for review (no estimates in v1).

const defaultSiteTZ = "Africa/Nairobi"

// Job types (billing_job_runs.job_type).
const (
	jobCreateCycle      = "create_cycle"
	jobPrepareInvoices  = "prepare_invoices"
	jobDailyCollections = "daily_collections"
)

// RunScheduler runs the billing job loop until the process exits.
// Fire-and-forget like the other service goroutines in server.go.
func RunScheduler(app core.App) {
	t := time.NewTicker(time.Minute)
	defer t.Stop()
	for now := range t.C {
		runOnce(app, now.UTC())
	}
}

func runOnce(app core.App, now time.Time) {
	sites, err := app.FindAllRecords("sites")
	if err != nil {
		log.Printf("billing: scheduler: %v", err)
		return
	}
	for _, site := range sites {
		if !HasCapability(app, site.Id, CapabilityTenantBilling) {
			continue
		}
		settings, _ := app.FindFirstRecordByFilter("billing_settings", "site = {:s}", dbx.Params{"s": site.Id})
		localNow := now.In(siteLocation(settings))

		ensureCurrentCycle(app, site, settings, localNow)
		if err := prepareDueCycles(app, site, settings, now); err != nil {
			log.Printf("billing: prepare %s: %v", site.Id, err)
		}

		// Daily collections pass, keyed on the site's local date. The work is
		// idempotent, so claim AFTER it succeeds — a crash mid-pass retries on
		// the next tick instead of losing the day.
		dayKey := localNow.Format("2006-01-02")
		if !jobRunExists(app, jobDailyCollections, site.Id+":"+dayKey) {
			markOverdue(app, site.Id, localNow)
			sweepSiteArrears(app, site, now)
			claimJob(app, site.Id, jobDailyCollections, site.Id+":"+dayKey, now)
		}
	}
}

// jobRunExists reports whether a job_run row already exists for the key.
func jobRunExists(app core.App, jobType, key string) bool {
	rec, _ := app.FindFirstRecordByFilter("billing_job_runs",
		"job_type = {:j} && business_key = {:k}", dbx.Params{"j": jobType, "k": key})
	return rec != nil
}

// claimJob inserts a succeeded job_run row; the unique (job_type,
// business_key) index means false = already ran (idempotency anchor).
func claimJob(app core.App, siteID, jobType, key string, now time.Time) bool {
	coll, err := app.FindCollectionByNameOrId("billing_job_runs")
	if err != nil {
		return false
	}
	rec := core.NewRecord(coll)
	if siteID != "" {
		rec.Set("site", siteID)
	}
	rec.Set("job_type", jobType)
	rec.Set("business_key", key)
	rec.Set("status", "succeeded")
	rec.Set("attempt", 1)
	rec.Set("started_at", now)
	rec.Set("finished_at", now)
	return app.Save(rec) == nil
}

// recordJob writes a terminal job_run (succeeded/failed). False = the key was
// already recorded, so the caller must treat the work as already done.
func recordJob(app core.App, siteID, jobType, key, status, errMsg string, now time.Time) bool {
	coll, err := app.FindCollectionByNameOrId("billing_job_runs")
	if err != nil {
		return false
	}
	rec := core.NewRecord(coll)
	if siteID != "" {
		rec.Set("site", siteID)
	}
	rec.Set("job_type", jobType)
	rec.Set("business_key", key)
	rec.Set("status", status)
	rec.Set("attempt", 1)
	rec.Set("started_at", now)
	rec.Set("finished_at", now)
	if errMsg != "" {
		rec.Set("error", errMsg)
	}
	return app.Save(rec) == nil
}

func siteLocation(settings *core.Record) *time.Location {
	if settings != nil {
		if loc, err := time.LoadLocation(settings.GetString("timezone")); err == nil {
			return loc
		}
	}
	loc, err := time.LoadLocation(defaultSiteTZ)
	if err != nil {
		return time.UTC
	}
	return loc
}

// ensureCurrentCycle creates the site's current monthly cycle (billing starts
// at the current period; no historical backfill). Dedupe is by DATA (the
// cycle row itself), the job_run row is audit — so a failed create retried on
// the next tick can't strand the month.
func ensureCurrentCycle(app core.App, site, settings *core.Record, localNow time.Time) {
	// Bounds in the site's timezone, then to UTC for storage — UTC-midnight
	// bounds would skew the period by the tz offset (e.g. 3h in Nairobi).
	loc := localNow.Location()
	start := time.Date(localNow.Year(), localNow.Month(), 1, 0, 0, 0, 0, loc).UTC()
	end := start.In(loc).AddDate(0, 1, 0).Add(-time.Second).UTC()
	key := fmt.Sprintf("cycle:%s:%s", site.Id, start.In(loc).Format("2006-01"))
	if jobRunExists(app, jobCreateCycle, key) {
		return
	}
	// Dedupe by data too: a cycle created without its audit row (or by an
	// operator) must not be duplicated — the unique period index would
	// otherwise make every tick fail loudly.
	if existing, _ := app.FindFirstRecordByFilter("billing_cycles",
		"site = {:s} && period_start = {:ps}", dbx.Params{"s": site.Id, "ps": start.Format(types.DefaultDateLayout)}); existing != nil {
		claimJob(app, site.Id, jobCreateCycle, key, time.Now().UTC())
		return
	}

	dueDay := 5
	if settings != nil && settings.GetInt("due_day") > 0 {
		dueDay = settings.GetInt("due_day")
	}
	// Due date: due_day (clamped) of the month FOLLOWING the period end —
	// the January bill falls due on February <due_day>.
	dueMonth := end.In(loc).AddDate(0, 1, 0)
	due := time.Date(dueMonth.Year(), dueMonth.Month(), 1, 0, 0, 0, 0, loc)
	lastOfDueMonth := due.AddDate(0, 1, 0).Add(-24 * time.Hour).Day()
	if dueDay > lastOfDueMonth {
		dueDay = lastOfDueMonth
	}
	due = due.AddDate(0, 0, dueDay-1).UTC()

	coll, err := app.FindCollectionByNameOrId("billing_cycles")
	if err != nil {
		return
	}
	cycle := core.NewRecord(coll)
	cycle.Set("site", site.Id)
	cycle.Set("period_start", start)
	cycle.Set("period_end", end)
	cycle.Set("due_date", due)
	cycle.Set("status", "open")
	cycle.Set("generated_at", time.Now().UTC())
	if err := app.Save(cycle); err != nil {
		log.Printf("billing: create cycle %s: %v", key, err)
		return // not claimed — retried on the next tick
	}
	claimJob(app, site.Id, jobCreateCycle, key, time.Now().UTC())
}

// prepareDueCycles drafts invoices for cycles whose period has ended. A cycle
// whose occupancies are all held (missing readings, no tariff) stays open and
// records a failed job run — operator review, per the hold-for-review policy.
func prepareDueCycles(app core.App, site, settings *core.Record, now time.Time) error {
	cycles, err := app.FindRecordsByFilter("billing_cycles",
		"site = {:s} && status = 'open'", "period_start", 20, 0, dbx.Params{"s": site.Id})
	if err != nil {
		return err
	}
	for _, cycle := range cycles {
		end := cycle.GetDateTime("period_end").Time()
		if end.IsZero() || end.After(now) {
			continue
		}
		// The daily key lets a held cycle retry on the next scheduler day —
		// and probing it BEFORE the work keeps a held cycle from re-running
		// the full prepare on every tick.
		key := "prepare:" + cycle.Id + ":" + now.Format("2006-01-02")
		if jobRunExists(app, jobPrepareInvoices, key) {
			continue
		}
		held, err := prepareCycle(app, cycle, settings, now)
		switch {
		case err != nil:
			recordJob(app, site.Id, jobPrepareInvoices, key, "failed", err.Error(), now)
			return err
		case len(held) > 0:
			recordJob(app, site.Id, jobPrepareInvoices, key, "failed",
				"held for review: "+strings.Join(held, "; "), now)
		default:
			recordJob(app, site.Id, jobPrepareInvoices, key, "succeeded", "", now)
			cycle.Set("status", "prepared")
			if err := app.Save(cycle); err != nil {
				return err
			}
		}
	}
	return nil
}

// prepareCycle drafts one invoice per liable occupancy. The returned held
// list names occupancies skipped for operator review (missing readings,
// negative deltas, no meter). Idempotent via the (cycle, tenant_account)
// unique index.
func prepareCycle(app core.App, cycle, settings *core.Record, now time.Time) ([]string, error) {
	siteID := cycle.GetString("site")
	start := cycle.GetDateTime("period_start").Time()
	end := cycle.GetDateTime("period_end").Time()

	tariffs, _ := app.FindRecordsByFilter("tariffs",
		"site = {:s} && status = 'active'", "-effective_from", 1, 0, dbx.Params{"s": siteID})
	if len(tariffs) == 0 {
		return nil, fmt.Errorf("no active tariff")
	}
	tariff := tariffs[0]

	currency := "KES"
	if settings != nil && settings.GetString("currency") != "" {
		currency = settings.GetString("currency")
	}

	occs, err := app.FindRecordsByFilter("occupancies", "site = {:s}", "", 500, 0, dbx.Params{"s": siteID})
	if err != nil {
		return nil, err
	}

	var held []string
	for _, occ := range occs {
		from := occ.GetDateTime("liable_from").Time()
		until := occ.GetDateTime("liable_until").Time()
		if (!from.IsZero() && from.After(end)) || (!until.IsZero() && until.Before(start)) {
			continue // not liable during this period
		}
		// One invoice per account per cycle (unique index). Skip if it exists.
		existing, _ := app.FindRecordsByFilter("invoices",
			"cycle = {:c} && tenant_account = {:a}", "", 1, 0,
			dbx.Params{"c": cycle.Id, "a": occ.GetString("tenant_account")})
		if len(existing) > 0 {
			continue
		}

		meters, err := app.FindRecordsByFilter("meter_devices",
			"unit = {:u}", "", 20, 0, dbx.Params{"u": occ.GetString("unit")})
		if err != nil {
			return nil, err
		}
		if len(meters) == 0 {
			held = append(held, "occupancy "+occ.Id+": no meter on unit")
			continue
		}

		var usages []meterUsage
		skip := false
		for _, m := range meters {
			opening, okOpen := boundaryReading(app, m.Id, start)
			closing, okClose := boundaryReading(app, m.Id, end)
			if !okOpen || !okClose {
				held = append(held, "meter "+m.Id+": missing boundary reading")
				skip = true
				break
			}
			delta := closing - opening
			if delta < 0 {
				held = append(held, "meter "+m.Id+": negative delta (reset?)")
				skip = true
				break
			}
			usages = append(usages, meterUsage{m, delta})
		}
		if skip {
			continue
		}

		if err := draftInvoice(app, cycle, occ, tariff, usages, currency, now); err != nil {
			return nil, err
		}
	}
	return held, nil
}

// boundaryReading returns the newest cumulative_ml at or before ts.
// Comparison happens in Go: PB date strings don't round-trip cleanly through
// RFC3339 filter binding. A meter reports at most ~daily, so 2000 rows cover
// years of history.
func boundaryReading(app core.App, meterID string, ts time.Time) (int64, bool) {
	recs, err := app.FindRecordsByFilter("meter_readings",
		"meter = {:m}", "-device_ts", 2000, 0, dbx.Params{"m": meterID})
	if err != nil {
		return 0, false
	}
	for _, r := range recs {
		rt := r.GetDateTime("device_ts").Time()
		if rt.IsZero() || rt.After(ts) {
			continue
		}
		return int64(r.GetInt("cumulative_ml")), true
	}
	return 0, false
}

// meterUsage is one meter's billable consumption over a billing period.
type meterUsage struct {
	meter   *core.Record
	usageMl int64
}

// draftInvoice creates the draft invoice + line items for one occupancy's
// cycle usage, with tariff values copied onto the lines (later tariff edits
// must not alter issued bills — architecture §4.3).
func draftInvoice(app core.App, cycle, occ, tariff *core.Record, usages []meterUsage, currency string, now time.Time) error {
	siteID := cycle.GetString("site")
	rate := int64(tariff.GetInt("rate_per_kl_minor"))
	standing := int64(tariff.GetInt("standing_charge_minor"))
	minimum := int64(tariff.GetInt("minimum_charge_minor"))
	taxBps := int64(tariff.GetInt("tax_bps"))

	return app.RunInTransaction(func(txApp core.App) error {
		invColl, err := txApp.FindCollectionByNameOrId("invoices")
		if err != nil {
			return err
		}
		lineColl, err := txApp.FindCollectionByNameOrId("invoice_lines")
		if err != nil {
			return err
		}

		var subtotal int64
		type pendingLine struct {
			typ, desc string
			qty       int64
			meter     string
			amount    int64
		}
		var lines []pendingLine
		for _, u := range usages {
			amount := (u.usageMl*rate + 500_000) / 1_000_000 // ml → kl, round half-up
			// Zero-amount lines are kept: quantity_ml is the audit trail for
			// sub-rounding consumption.
			lines = append(lines, pendingLine{
				typ:    "usage",
				desc:   fmt.Sprintf("Water usage %d L", u.usageMl/1000),
				qty:    u.usageMl,
				meter:  u.meter.Id,
				amount: amount,
			})
			subtotal += amount
		}
		if standing > 0 {
			lines = append(lines, pendingLine{typ: "standing_charge", desc: "Standing charge", amount: standing})
			subtotal += standing
		}
		if minimum > 0 && subtotal < minimum {
			adj := minimum - subtotal
			lines = append(lines, pendingLine{typ: "minimum_charge", desc: "Minimum charge adjustment", amount: adj})
			subtotal += adj
		}
		tax := subtotal * taxBps / 10_000

		inv := core.NewRecord(invColl)
		inv.Set("site", siteID)
		inv.Set("tenant_account", occ.GetString("tenant_account"))
		inv.Set("cycle", cycle.Id)
		inv.Set("invoice_number", nextInvoiceNumber(txApp, siteID, cycle))
		inv.Set("currency", currency)
		inv.Set("subtotal_minor", subtotal)
		inv.Set("tax_minor", tax)
		inv.Set("total_minor", subtotal+tax)
		inv.Set("allocated_minor", 0)
		inv.Set("status", "draft")
		inv.Set("due_date", cycle.GetDateTime("due_date").Time())
		if err := txApp.Save(inv); err != nil {
			return err
		}

		for _, l := range lines {
			line := core.NewRecord(lineColl)
			line.Set("site", siteID)
			line.Set("invoice", inv.Id)
			line.Set("type", l.typ)
			line.Set("description", l.desc)
			line.Set("quantity_ml", l.qty)
			line.Set("unit_price_minor", rate)
			line.Set("amount_minor", l.amount)
			if l.meter != "" {
				line.Set("meter", l.meter)
			}
			line.Set("occupancy", occ.Id)
			line.Set("quality", "actual")
			if err := txApp.Save(line); err != nil {
				return err
			}
		}
		if tax > 0 {
			line := core.NewRecord(lineColl)
			line.Set("site", siteID)
			line.Set("invoice", inv.Id)
			line.Set("type", "tax")
			line.Set("description", "Tax")
			line.Set("amount_minor", tax)
			line.Set("occupancy", occ.Id)
			if err := txApp.Save(line); err != nil {
				return err
			}
		}
		return nil
	})
}

// nextInvoiceNumber: INV-<yyyymm>-<seq4>, seq counting the site's invoices in
// the cycle's period month. The unique (site, invoice_number) index guards
// races; a collision surfaces as a save error, not a duplicate.
func nextInvoiceNumber(app core.App, siteID string, cycle *core.Record) string {
	end := cycle.GetDateTime("period_end").Time()
	prefix := fmt.Sprintf("INV-%s-", end.Format("200601"))
	// The prefix holds no LIKE wildcards (% or _), so no escaping is needed.
	n, _ := app.CountRecords("invoices",
		dbx.HashExp{"site": siteID},
		dbx.Like("invoice_number", prefix))
	return fmt.Sprintf("%s%04d", prefix, n+1)
}

// markOverdue flips issued/partially_paid invoices past their due date to
// overdue (site-local day granularity).
func markOverdue(app core.App, siteID string, localNow time.Time) {
	invs, err := app.FindRecordsByFilter("invoices",
		"site = {:s} && (status = 'issued' || status = 'partially_paid')", "", 1000, 0,
		dbx.Params{"s": siteID})
	if err != nil {
		return
	}
	today := time.Date(localNow.Year(), localNow.Month(), localNow.Day(), 0, 0, 0, 0, localNow.Location())
	for _, inv := range invs {
		due := inv.GetDateTime("due_date").Time()
		if due.IsZero() || !due.In(localNow.Location()).Before(today) {
			continue
		}
		inv.Set("status", "overdue")
		if err := app.Save(inv); err != nil {
			log.Printf("billing: mark overdue %s: %v", inv.Id, err)
		}
	}
}
