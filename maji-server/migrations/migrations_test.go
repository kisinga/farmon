package migrations_test

import (
	"fmt"
	"os"
	"strings"
	"testing"

	"github.com/kisinga/majiflow/migrations" // register the Go migrations
	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tests"
)

// Every registered migration must apply cleanly on a fresh database, leaving the
// expected end-state schema. Catches a broken/renumbered migration in CI rather
// than at deploy. (NewTestApp boots a temp app and runs all registered migrations.)
func TestMigrationsApplyCleanly(t *testing.T) {
	app, err := tests.NewTestApp()
	if err != nil {
		t.Fatalf("migrations did not apply on a fresh database: %v", err)
	}
	defer app.Cleanup()

	// 23_automations created the collection.
	if _, err := app.FindCollectionByNameOrId("automations"); err != nil {
		t.Fatalf("automations collection missing: %v", err)
	}

	commands, err := app.FindCollectionByNameOrId("commands")
	if err != nil {
		t.Fatalf("commands collection missing: %v", err)
	}
	// 25_drop_automation_command removed the field...
	if commands.Fields.GetByName("automation_id") != nil {
		t.Error("commands.automation_id should have been dropped (migration 25)")
	}
	// ...and the action enum value.
	action, ok := commands.Fields.GetByName("action").(*core.SelectField)
	if !ok {
		t.Fatal("commands.action is not a select field")
	}
	for _, v := range action.Values {
		if v == "automation_set" {
			t.Error("commands.action still offers automation_set (migration 25)")
		}
	}
	// 30_command_node added the actuator-target fields the command history reads.
	if commands.Fields.GetByName("node_id") == nil {
		t.Error("commands.node_id should exist (migration 30)")
	}
	if commands.Fields.GetByName("node_on") == nil {
		t.Error("commands.node_on should exist (migration 30)")
	}

	// 31_state_events_origin added the attribution fields the timeline reads to
	// show who/what caused each route transition.
	events, err := app.FindCollectionByNameOrId("state_events")
	if err != nil {
		t.Fatalf("state_events collection missing: %v", err)
	}
	for _, f := range []string{"origin", "actor", "actor_label"} {
		if events.Fields.GetByName(f) == nil {
			t.Errorf("state_events.%s should exist (migration 31)", f)
		}
	}

	// 33 dropped the dead commercial tier and added the segment + entitlement fields;
	// 34 added the packs relation; 46 denormalized the catalog counts.
	sites, err := app.FindCollectionByNameOrId("sites")
	if err != nil {
		t.Fatalf("sites collection missing: %v", err)
	}
	if sites.Fields.GetByName("tier") != nil {
		t.Error("sites.tier should have been dropped (migration 33)")
	}
	for _, f := range []string{"segment", "price_override", "addons", "packs", "controller_count", "node_count", "device_count", "live_count"} {
		if sites.Fields.GetByName(f) == nil {
			t.Errorf("sites.%s should exist (migrations 33/34/46)", f)
		}
	}
	// 34 created the entitlement catalog.
	packs, err := app.FindCollectionByNameOrId("packs")
	if err != nil {
		t.Fatalf("packs collection missing (migration 34): %v", err)
	}
	if packs.Fields.GetByName("key") == nil {
		t.Error("packs.key should exist (migration 34)")
	}

	incidents, err := app.FindCollectionByNameOrId("notification_incidents")
	if err != nil {
		t.Fatalf("notification_incidents collection missing (migration 41): %v", err)
	}
	for _, f := range []string{"incident_key", "kind", "status", "first_seen", "last_seen", "last_sent", "resolved_at"} {
		if incidents.Fields.GetByName(f) == nil {
			t.Errorf("notification_incidents.%s should exist (migration 41)", f)
		}
	}
	// Partner read of incidents came from 49/55 (62 only checkpoints the rule —
	// its up is a byte-identical no-op; see 62_incidents_partner_read.go).
	// Writes must stay admin-only.
	if incidents.ListRule == nil || !strings.Contains(*incidents.ListRule, "site.partner.id ?= @request.auth.partner") {
		t.Error("notification_incidents ListRule should include the partner clause (migrations 49/55)")
	}
	if incidents.ViewRule == nil || !strings.Contains(*incidents.ViewRule, "site.partner.id ?= @request.auth.partner") {
		t.Error("notification_incidents ViewRule should include the partner clause (migrations 49/55)")
	}
	if incidents.CreateRule == nil || !strings.Contains(*incidents.CreateRule, `"admin"`) || strings.Contains(*incidents.CreateRule, "partner") {
		t.Error("notification_incidents CreateRule should stay admin-only")
	}

	// 63: the org-scoping partner clause is partner-role-only everywhere — a
	// customer's users.partner also points at the org, so without the role guard
	// the clause leaked the whole org's sites (and site children) to any customer.
	for _, c := range []*core.Collection{sites, incidents} {
		if c.ListRule == nil || !strings.Contains(*c.ListRule, `(@request.auth.role = "partner" && @request.auth.partner != "" &&`) {
			t.Errorf("%s ListRule partner clause should be partner-role-guarded (migration 63)", c.Name)
		}
	}

	// 57–59: tenant-billing core + Shengda metering + financial spine.
	for name, fields := range map[string][]string{
		"billing_units":        {"site", "code", "status"},
		"tenant_accounts":      {"site", "account_number", "name", "phone"},
		"occupancies":          {"site", "unit", "tenant_account", "liable_from", "liable_until"},
		"billing_settings":     {"site", "grace_days", "warn_days", "auto_valve_enabled"},
		"tariffs":              {"site", "rate_per_kl_minor", "tax_bps"},
		"meter_devices":        {"site", "imei", "valve_capable", "valve_state", "last_reading_ml"},
		"meter_readings":       {"site", "meter", "device_ts", "cumulative_ml", "message_id", "raw_cbor", "raw_hex"},
		"meter_commands":       {"site", "meter", "type", "status", "queued_by"},
		"meter_sightings":      {"imei", "sn", "source_ip", "status"},
		"meter_events":         {"site", "meter", "type", "severity"},
		"billing_cycles":       {"site", "period_start", "period_end", "due_date", "status"},
		"invoices":             {"site", "tenant_account", "cycle", "invoice_number", "total_minor", "allocated_minor", "status"},
		"invoice_lines":        {"site", "invoice", "type", "amount_minor", "quantity_ml"},
		"payment_transactions": {"site", "tenant_account", "provider", "provider_transaction_id", "amount_minor", "processing_status"},
		"payment_allocations":  {"site", "payment", "invoice", "amount_minor"},
		"billing_job_runs":     {"site", "job_type", "business_key", "status"},
	} {
		c, err := app.FindCollectionByNameOrId(name)
		if err != nil {
			t.Errorf("%s collection missing (migrations 57-59): %v", name, err)
			continue
		}
		for _, f := range fields {
			if c.Fields.GetByName(f) == nil {
				t.Errorf("%s.%s should exist (migrations 57-59)", name, f)
			}
		}
	}
	// Reading dedupe idempotency anchor (random 16-bit message_id alone is unsafe).
	readings, err := app.FindCollectionByNameOrId("meter_readings")
	if err != nil {
		t.Fatal(err)
	}
	foundDedupe := false
	for _, idx := range readings.Indexes {
		var parsed struct {
			Unique bool `json:"unique"`
		}
		if strings.Contains(idx, "meter,message_id,device_ts") {
			foundDedupe = true
		}
		_ = parsed
	}
	if !foundDedupe {
		t.Error("meter_readings should have a unique (meter,message_id,device_ts) dedupe index")
	}

	// 61_dashboard_layouts: per-site dashboard layout blobs for the dashboard rework.
	layouts, err := app.FindCollectionByNameOrId("dashboard_layouts")
	if err != nil {
		t.Fatalf("dashboard_layouts collection missing (migration 61): %v", err)
	}
	for _, f := range []string{"key", "site", "user", "layout"} {
		if layouts.Fields.GetByName(f) == nil {
			t.Errorf("dashboard_layouts.%s should exist (migration 61)", f)
		}
	}
	foundLayoutKey := false
	for _, idx := range layouts.Indexes {
		if strings.Contains(idx, "key,site,user") {
			foundLayoutKey = true
		}
	}
	if !foundLayoutKey {
		t.Error("dashboard_layouts should have a unique (key,site,user) index")
	}
}

// Migration 56 backfills alert_device_online for existing offline-alert
// subscribers: 47 added the toggle opt-in (default false) without a backfill,
// so their back-online notifications silently never went out.
func TestBackfillDeviceOnline(t *testing.T) {
	app, err := tests.NewTestApp()
	if err != nil {
		t.Fatalf("migrations did not apply on a fresh database: %v", err)
	}
	defer app.Cleanup()

	users, err := app.FindCollectionByNameOrId("users")
	if err != nil {
		t.Fatal(err)
	}
	prefsColl, err := app.FindCollectionByNameOrId("notification_prefs")
	if err != nil {
		t.Fatal(err)
	}

	i := 0
	mk := func(offline, online bool) *core.Record {
		i++
		user := core.NewRecord(users)
		user.Set("email", fmt.Sprintf("owner%d@example.com", i))
		user.Set("password", "password123")
		if err := app.Save(user); err != nil {
			t.Fatal(err)
		}
		r := core.NewRecord(prefsColl)
		r.Set("user", user.Id)
		r.Set("alert_device_offline", offline)
		r.Set("alert_device_online", online)
		if err := app.Save(r); err != nil {
			t.Fatal(err)
		}
		return r
	}
	legacy := mk(true, false) // offline subscriber predating the toggle — the gap
	paired := mk(true, true)  // already opted into both
	other := mk(false, false) // not an offline subscriber

	if err := migrations.BackfillDeviceOnline(app); err != nil {
		t.Fatal(err)
	}

	got := func(id string) (offline, online bool) {
		r, err := app.FindRecordById("notification_prefs", id)
		if err != nil {
			t.Fatal(err)
		}
		return r.GetBool("alert_device_offline"), r.GetBool("alert_device_online")
	}

	if _, on := got(legacy.Id); !on {
		t.Error("legacy offline subscriber should be backfilled to alert_device_online = true")
	}
	if _, on := got(paired.Id); !on {
		t.Error("already-paired subscriber should keep alert_device_online = true")
	}
	if _, on := got(other.Id); on {
		t.Error("non-offline subscriber must not gain alert_device_online")
	}
}

// Each migration file must have a unique NN_ number. Two files sharing a number
// (e.g. a merge adding 24_x while 24_y already exists) makes apply order ambiguous
// — exactly the collision that prompted this guard.
func TestMigrationNumbersUnique(t *testing.T) {
	entries, err := os.ReadDir(".")
	if err != nil {
		t.Fatal(err)
	}
	seen := map[string]string{}
	for _, e := range entries {
		name := e.Name()
		if e.IsDir() || !strings.HasSuffix(name, ".go") || strings.HasSuffix(name, "_test.go") {
			continue
		}
		num, _, found := strings.Cut(name, "_")
		if !found {
			continue // helper file without a number prefix
		}
		if prev, dup := seen[num]; dup {
			t.Errorf("duplicate migration number %q: %s and %s", num, prev, name)
		}
		seen[num] = name
	}
}
