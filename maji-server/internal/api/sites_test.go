package api_test

import (
	"testing"

	"github.com/kisinga/majiflow/internal/api"
	_ "github.com/kisinga/majiflow/migrations"
	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tests"
)

// seedCatalog creates two sites, one admin, one customer, and two controllers.
// Site A is unassigned; site B is owned by the customer.
func seedCatalog(t testing.TB, app core.App) (admin *core.Record, customer *core.Record) {
	t.Helper()

	rec := func(coll string) *core.Record {
		c, err := app.FindCollectionByNameOrId(coll)
		if err != nil {
			t.Fatal(err)
		}
		return core.NewRecord(c)
	}

	save := func(r *core.Record) {
		if err := app.Save(r); err != nil {
			t.Fatal(err)
		}
	}

	admin = rec("users")
	admin.Set("email", "admin@example.com")
	admin.Set("password", "password123")
	admin.Set("passwordConfirm", "password123")
	admin.Set("role", "admin")
	admin.Set("verified", true)
	save(admin)

	customer = rec("users")
	customer.Set("email", "customer@example.com")
	customer.Set("password", "password123")
	customer.Set("passwordConfirm", "password123")
	customer.Set("role", "customer")
	customer.Set("verified", true)
	save(customer)

	// Site A: admin-owned, no controllers, topology with 2 controllers / 3 nodes.
	siteA := rec("sites")
	siteA.Id = "siteaaaaaaaaaa1"
	siteA.Set("name", "Alpha")
	siteA.Set("draft_topology", map[string]any{
		"schema":          1,
		"controllers":     []any{map[string]any{"id": "c1"}, map[string]any{"id": "c2"}},
		"nodes":           []any{map[string]any{"id": "n1"}, map[string]any{"id": "n2"}, map[string]any{"id": "n3"}},
		"pipes":           []any{},
		"route_overrides": map[string]any{},
		"timing":          map[string]any{},
	})
	siteA.Set("tank_low_pct", 15)
	siteA.Set("tank_high_pct", 85)
	siteA.Set("offline_timeout_s", 300)
	save(siteA)

	// Site B: customer-owned, one active+seen controller and one inactive controller.
	siteB := rec("sites")
	siteB.Id = "sitebbbbbbbbbb1"
	siteB.Set("name", "Bravo")
	siteB.Set("owner", []string{customer.Id})
	siteB.Set("draft_topology", map[string]any{
		"schema":          1,
		"controllers":     []any{map[string]any{"id": "c3"}},
		"nodes":           []any{map[string]any{"id": "n4"}},
		"pipes":           []any{},
		"route_overrides": map[string]any{},
		"timing":          map[string]any{},
	})
	siteB.Set("tank_low_pct", 25)
	siteB.Set("tank_high_pct", 90)
	siteB.Set("offline_timeout_s", 600)
	save(siteB)

	ctrlB1 := rec("controllers")
	ctrlB1.Id = "ctrlb1"
	ctrlB1.Set("site", siteB.Id)
	ctrlB1.Set("active", true)
	ctrlB1.Set("last_seen", "2026-07-09T10:00:00Z")
	save(ctrlB1)

	ctrlB2 := rec("controllers")
	ctrlB2.Id = "ctrlb2"
	ctrlB2.Set("site", siteB.Id)
	ctrlB2.Set("active", false)
	ctrlB2.Set("last_seen", "")
	save(ctrlB2)

	return admin, customer
}

func findEntry(entries []api.SiteCatalogEntry, id string) *api.SiteCatalogEntry {
	for i := range entries {
		if entries[i].ID == id {
			return &entries[i]
		}
	}
	return nil
}

func TestListSitesAdminSeesAll(t *testing.T) {
	app, err := tests.NewTestApp()
	if err != nil {
		t.Fatal(err)
	}
	defer app.Cleanup()

	admin, _ := seedCatalog(t, app)
	entries, err := api.ListSites(app, admin)
	if err != nil {
		t.Fatalf("ListSites failed: %v", err)
	}
	if len(entries) != 2 {
		t.Fatalf("admin should see 2 sites, got %d", len(entries))
	}

	alpha := findEntry(entries, "siteaaaaaaaaaa1")
	if alpha == nil {
		t.Fatal("admin missing Alpha site")
	}
	if alpha.ControllerCount != 2 || alpha.NodeCount != 3 {
		t.Errorf("Alpha counts wrong: got %d controllers, %d nodes", alpha.ControllerCount, alpha.NodeCount)
	}
	if alpha.DeviceCount != 0 || alpha.LiveCount != 0 {
		t.Errorf("Alpha device/live counts wrong: got %d/%d", alpha.DeviceCount, alpha.LiveCount)
	}
	if alpha.TankLowPct != 15 || alpha.TankHighPct != 85 || alpha.OfflineTimeoutS != 300 {
		t.Errorf("Alpha thresholds wrong: %v", alpha)
	}

	bravo := findEntry(entries, "sitebbbbbbbbbb1")
	if bravo == nil {
		t.Fatal("admin missing Bravo site")
	}
	if bravo.ControllerCount != 1 || bravo.NodeCount != 1 {
		t.Errorf("Bravo counts wrong: got %d controllers, %d nodes", bravo.ControllerCount, bravo.NodeCount)
	}
	if bravo.DeviceCount != 1 || bravo.LiveCount != 1 {
		t.Errorf("Bravo device/live counts wrong: got %d/%d", bravo.DeviceCount, bravo.LiveCount)
	}
}

func TestListSitesCustomerSeesOnlyOwned(t *testing.T) {
	app, err := tests.NewTestApp()
	if err != nil {
		t.Fatal(err)
	}
	defer app.Cleanup()

	_, customer := seedCatalog(t, app)
	entries, err := api.ListSites(app, customer)
	if err != nil {
		t.Fatalf("ListSites failed: %v", err)
	}
	if len(entries) != 1 {
		t.Fatalf("customer should see 1 site, got %d", len(entries))
	}
	if entries[0].ID != "sitebbbbbbbbbb1" {
		t.Errorf("customer saw wrong site: %s", entries[0].ID)
	}
}
