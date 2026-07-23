package billing

import (
	"errors"
	"fmt"
	"log"
	"time"

	"github.com/kisinga/majiflow/internal/alerts"
	"github.com/kisinga/majiflow/internal/metering"
	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/core"
)

// Arrears automation (spec §5): invoice overdue past grace_days → warning →
// still unpaid after warn_days → valve_close queued for the meter's next
// contact. Payment settling the account → valve_open. The rule NEVER closes
// without a prior warning and is idempotent across restarts: warned_at plus
// the per-meter valve_state / pending-command checks make a repeated sweep a
// no-op. closed_at on the invoice records INTENT ("closure initiated"), not
// completion — physical state is per meter (meter_devices.valve_state +
// pending meter_commands), so a partially-failed close is retried by later
// sweeps until every meter is shut.

// ArrearsRule is the reserved queued_by/allocated_by actor id for actions the
// arrears automation takes (no human user).
const ArrearsRule = "rule:arrears"

// RunArrearsSweep evaluates every capable site's overdue invoices once. Called
// daily per site timezone by the scheduler; exported for tests.
func RunArrearsSweep(app core.App, now time.Time) {
	sites, err := app.FindAllRecords("sites")
	if err != nil {
		log.Printf("billing: arrears sweep: %v", err)
		return
	}
	for _, site := range sites {
		sweepSiteArrears(app, site, now)
	}
}

// sweepSiteArrears runs the arrears rule for one site (no-op when the site
// lacks the capability or has auto_valve_enabled off).
func sweepSiteArrears(app core.App, site *core.Record, now time.Time) {
	if !HasCapability(app, site.Id, CapabilityTenantBilling) {
		return
	}
	settings, _ := app.FindFirstRecordByFilter("billing_settings", "site = {:s}", dbx.Params{"s": site.Id})
	if settings == nil || !settings.GetBool("auto_valve_enabled") {
		return
	}
	grace := time.Duration(settings.GetInt("grace_days")) * 24 * time.Hour
	warn := time.Duration(settings.GetInt("warn_days")) * 24 * time.Hour

	overdue, err := app.FindRecordsByFilter("invoices",
		"site = {:s} && status = 'overdue'", "due_date", 500, 0, dbx.Params{"s": site.Id})
	if err != nil {
		log.Printf("billing: arrears sweep %s: %v", site.Id, err)
		return
	}
	for _, inv := range overdue {
		evaluateArrears(app, inv, settings, grace, warn, now)
	}
}

func evaluateArrears(app core.App, inv, settings *core.Record, grace, warn time.Duration, now time.Time) {
	due := inv.GetDateTime("due_date").Time()
	if due.IsZero() || now.Sub(due) <= grace {
		return
	}

	// (a) warning first — never close unwarned.
	warnedAt := inv.GetDateTime("warned_at").Time()
	if warnedAt.IsZero() {
		account, err := app.FindRecordById("tenant_accounts", inv.GetString("tenant_account"))
		if err != nil || account == nil {
			return
		}
		subject := fmt.Sprintf("Payment reminder: invoice %s overdue", inv.GetString("invoice_number"))
		body := fmt.Sprintf(
			"Invoice %s for %d.%02d %s was due %s and is still unpaid. "+
				"Please pay within %d day(s) to avoid water disconnection.",
			inv.GetString("invoice_number"),
			inv.GetInt("total_minor")/100, inv.GetInt("total_minor")%100,
			inv.GetString("currency"), due.Format("2006-01-02"),
			settings.GetInt("warn_days"))
		if err := alerts.SendExternal(app,
			nonEmpty(account.GetString("email")),
			nonEmpty(account.GetString("phone")),
			subject, body); err != nil {
			log.Printf("billing: arrears warning %s: %v", inv.Id, err)
			// Still mark warned: delivery failures are logged, but the clock
			// must not restart forever on a flaky channel.
		}
		inv.Set("warned_at", now)
		if err := app.Save(inv); err != nil {
			log.Printf("billing: arrears warn save %s: %v", inv.Id, err)
		}
		return
	}

	// (b) close only after warn_days have passed since the warning. Physical
	// state is per meter: every sweep retries any meter that is neither
	// closed nor has a closure in flight, so a partial failure recovers on a
	// later sweep (bounded downstream by the metering-level attempts cap).
	if now.Sub(warnedAt) <= warn {
		return
	}
	closureInitiated := false
	for _, meter := range accountMeters(app, inv.GetString("tenant_account")) {
		if meter.GetString("valve_state") == "closed" {
			closureInitiated = true
			continue
		}
		if metering.HasPendingValve(app, meter.Id) {
			closureInitiated = true
			continue
		}
		_, err := metering.EnqueueValve(app, meter, true, ArrearsRule, "rule")
		switch {
		case err == nil:
			closureInitiated = true
			log.Printf("billing: arrears: queued valve_close for meter %s (invoice %s)", meter.Id, inv.Id)
		case errors.Is(err, metering.ErrValveNoChange), errors.Is(err, metering.ErrValvePending):
			// Idempotency: already closed or a command is in flight.
			closureInitiated = true
		default:
			log.Printf("billing: arrears close meter %s: %v", meter.Id, err)
		}
	}
	// closed_at records intent ("closure initiated"): set once, the first
	// time at least one meter is closed or has a closure queued, and never
	// overwritten by later sweeps. The invoice is saved only when changed.
	if closureInitiated && inv.GetDateTime("closed_at").IsZero() {
		inv.Set("closed_at", now)
		if err := app.Save(inv); err != nil {
			log.Printf("billing: arrears close save %s: %v", inv.Id, err)
		}
	}
}

// ReevaluateAfterPayment reopens valves when an account's arrears are fully
// settled. Called after every successful payment allocation. "Settled" means
// no overdue invoice and no past-due partially-paid one — a freshly issued,
// not-yet-due invoice must NOT keep the valve closed (spec §5: payment
// covering arrears → valve_open).
func ReevaluateAfterPayment(app core.App, tenantAccountID string) {
	now := time.Now().UTC()
	candidates, err := app.FindRecordsByFilter("invoices",
		"tenant_account = {:a} && (status = 'overdue' || status = 'partially_paid')",
		"", 100, 0, dbx.Params{"a": tenantAccountID})
	if err != nil {
		return
	}
	for _, inv := range candidates {
		if inv.GetString("status") == "overdue" {
			return
		}
		due := inv.GetDateTime("due_date").Time()
		if !due.IsZero() && due.Before(now) {
			return // past-due and not fully paid
		}
	}
	closedByRule, err := app.FindRecordsByFilter("invoices",
		"tenant_account = {:a} && closed_at != ''", "", 50, 0, dbx.Params{"a": tenantAccountID})
	if err != nil || len(closedByRule) == 0 {
		return
	}
	account, err := app.FindRecordById("tenant_accounts", tenantAccountID)
	if err != nil || account == nil {
		return
	}
	reopened := false
	allReopened := true
	for _, meter := range accountMeters(app, tenantAccountID) {
		// A queued-but-undelivered close is superseded by the payment: the
		// account settled before the meter ever heard the command, so cancel
		// it — otherwise the valve would close at the next contact with
		// closed_at already cleared and nothing reopening it. A close
		// already SENT can't be cancelled safely (the device may execute
		// it), so that meter counts as not reopened.
		if pending, _ := metering.PendingValve(app, meter.Id); pending != nil && pending.GetString("type") == metering.CmdValveClose {
			if pending.GetString("status") != "queued" {
				allReopened = false
				log.Printf("billing: arrears reopen meter %s: close already sent, cannot cancel", meter.Id)
				continue
			}
			if err := app.Delete(pending); err != nil {
				allReopened = false
				log.Printf("billing: arrears reopen meter %s: cancel pending close: %v", meter.Id, err)
				continue
			}
			log.Printf("billing: arrears: cancelled pending valve_close for meter %s (account settled)", meter.Id)
		}
		if meter.GetString("valve_state") != "closed" {
			continue // open with no close in flight — counts as reopened
		}
		_, err := metering.EnqueueValve(app, meter, false, ArrearsRule, "rule")
		switch {
		case err == nil:
			reopened = true
			log.Printf("billing: arrears: queued valve_open for meter %s (account settled)", meter.Id)
		case errors.Is(err, metering.ErrValveNoChange), errors.Is(err, metering.ErrValvePending):
			// Already open or a command is in flight — counts as reopened.
		default:
			allReopened = false
			log.Printf("billing: arrears reopen meter %s: %v", meter.Id, err)
		}
	}
	if !allReopened {
		// At least one meter could not be reopened — keep closed_at so a
		// later payment or manual action re-triggers the reopen.
		return
	}
	for _, inv := range closedByRule {
		inv.Set("closed_at", "")
		_ = app.Save(inv)
	}
	if reopened {
		_ = alerts.SendExternal(app,
			nonEmpty(account.GetString("email")),
			nonEmpty(account.GetString("phone")),
			"Payment received — water supply restoration queued",
			"Your payment has settled the outstanding balance. A command to reopen your water valve has been queued and takes effect at your meter's next contact (typically within 24 hours).")
	}
}

// nonEmpty wraps a recipient address in a slice, dropping the empty case so a
// missing contact doesn't reach the mailer/OpenWA as an empty address.
func nonEmpty(s string) []string {
	if s == "" {
		return nil
	}
	return []string{s}
}

// accountMeters resolves the meters serving an account: occupancies → units →
// meter_devices.
func accountMeters(app core.App, tenantAccountID string) []*core.Record {
	occs, err := app.FindRecordsByFilter("occupancies",
		"tenant_account = {:a}", "", 100, 0, dbx.Params{"a": tenantAccountID})
	if err != nil || len(occs) == 0 {
		return nil
	}
	units := make([]string, 0, len(occs))
	for _, o := range occs {
		if u := o.GetString("unit"); u != "" {
			units = append(units, u)
		}
	}
	var out []*core.Record
	seen := map[string]bool{}
	for _, u := range units {
		meters, err := app.FindRecordsByFilter("meter_devices",
			"unit = {:u}", "", 20, 0, dbx.Params{"u": u})
		if err != nil {
			continue
		}
		for _, m := range meters {
			if !seen[m.Id] {
				seen[m.Id] = true
				out = append(out, m)
			}
		}
	}
	return out
}
