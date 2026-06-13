package migrations_test

import (
	"strings"
	"testing"

	_ "github.com/kisinga/majiflow/migrations"
	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tests"
)

func mkUser(t *testing.T, app core.App, email, role string) *core.Record {
	t.Helper()
	users, err := app.FindCollectionByNameOrId("users")
	if err != nil {
		t.Fatal(err)
	}
	u := core.NewRecord(users)
	u.Set("email", email)
	u.Set("password", "password123")
	u.Set("role", role)
	if err := app.Save(u); err != nil {
		t.Fatalf("save user %s: %v", email, err)
	}
	return u
}

func canView(t *testing.T, app core.App, site, auth *core.Record) bool {
	t.Helper()
	sites, _ := app.FindCollectionByNameOrId("sites")
	info := &core.RequestInfo{Auth: auth, Method: "GET", Context: "view"}
	ok, err := app.CanAccessRecord(site, info, sites.ViewRule)
	if err != nil {
		t.Fatalf("rule eval errored: %v", err)
	}
	return ok
}

func run26Up(t *testing.T, app core.App) {
	t.Helper()
	runMigration(t, app, "26_site_multi_owner")
}

func runMigration(t *testing.T, app core.App, file string) {
	t.Helper()
	for _, mig := range core.AppMigrations.Items() {
		if strings.Contains(mig.File, file) {
			if err := mig.Up(app); err != nil {
				t.Fatalf("%s up: %v", file, err)
			}
			return
		}
	}
	t.Fatalf("migration %s not found", file)
}

// The co-owner RBAC rule must match for a co-owner across every way the owner
// column can end up stored, and must deny a non-owner.
func TestSiteOwnerRuleMatch(t *testing.T) {
	app, err := tests.NewTestApp()
	if err != nil {
		t.Fatal(err)
	}
	defer app.Cleanup()

	cust := mkUser(t, app, "c@x.com", "customer")
	other := mkUser(t, app, "o@x.com", "customer")
	sites, _ := app.FindCollectionByNameOrId("sites")

	mk := func(name, rawOwner string) *core.Record {
		r := core.NewRecord(sites)
		r.Set("name", name)
		r.Set("owner", []string{cust.Id})
		if err := app.Save(r); err != nil {
			t.Fatal(err)
		}
		if _, err := app.DB().NewQuery("UPDATE sites SET owner = {:v} WHERE id = {:id}").
			Bind(map[string]any{"v": rawOwner, "id": r.Id}).Execute(); err != nil {
			t.Fatal(err)
		}
		fresh, _ := app.FindRecordById("sites", r.Id)
		return fresh
	}

	bare := mk("bare", cust.Id)
	array := mk("array", `["`+cust.Id+`"]`)
	if !canView(t, app, bare, cust) {
		t.Error("co-owner denied on bare-id owner")
	}
	if !canView(t, app, array, cust) {
		t.Error("co-owner denied on array owner")
	}
	if canView(t, app, array, other) {
		t.Error("non-owner allowed")
	}
}

// Regression for the live incident: migration 26 widened owner single→multi, and
// PocketBase's auto-conversion turned a JSON-quoted owner (`"id"`) into a
// quote-mangled array (`["\"id\""]`) that the rule can't match. Migration 27 must
// recover the real id and restore co-owner access.
func TestMigration27RepairsMangledOwner(t *testing.T) {
	app, err := tests.NewTestApp()
	if err != nil {
		t.Fatal(err)
	}
	defer app.Cleanup()

	cust := mkUser(t, app, "c@x.com", "customer")
	sites, _ := app.FindCollectionByNameOrId("sites")

	// Recreate the live pre-26 shape: single-relation field, owner stored as a
	// JSON-quoted string (the format that triggered the bug).
	owner := sites.Fields.GetByName("owner").(*core.RelationField)
	owner.MaxSelect = 1
	if err := app.Save(sites); err != nil {
		t.Fatal(err)
	}
	site := core.NewRecord(sites)
	site.Set("name", "Riverside")
	site.Set("owner", cust.Id)
	if err := app.Save(site); err != nil {
		t.Fatal(err)
	}
	if _, err := app.DB().NewQuery("UPDATE sites SET owner = {:v} WHERE id = {:id}").
		Bind(map[string]any{"v": `"` + cust.Id + `"`, "id": site.Id}).Execute(); err != nil {
		t.Fatal(err)
	}

	// Apply 26 (mangles the quoted owner) then confirm the customer is locked out.
	run26Up(t, app)
	broken, _ := app.FindRecordById("sites", site.Id)
	t.Logf("post-26 mangled owner = %#v", broken.Get("owner"))
	if canView(t, app, broken, cust) {
		t.Skip("environment did not reproduce the mangle; nothing to repair")
	}

	// Apply 27 and confirm access is restored.
	runMigration(t, app, "27_repair_site_owner")
	fixed, _ := app.FindRecordById("sites", site.Id)
	t.Logf("post-27 repaired owner = %#v", fixed.Get("owner"))
	if !canView(t, app, fixed, cust) {
		t.Error("migration 27 did not restore co-owner access")
	}
}
