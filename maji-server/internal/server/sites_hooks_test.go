package server

import (
	"bytes"
	"encoding/json"
	"net/http"
	"testing"

	"github.com/kisinga/majiflow/internal/config"
	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tests"
)

// seedSiteAndController creates a site with two controllers in draft_topology and
// one provisioned controller, then checks the denormalized counts.
func TestHooksKeepSiteCounts(t *testing.T) {
	app, err := tests.NewTestApp()
	if err != nil {
		t.Fatal(err)
	}
	defer app.Cleanup()

	cfg := config.Config{Mode: config.ModeCloud}
	registerSiteHooks(app, cfg)

	coll := func(name string) *core.Collection {
		c, err := app.FindCollectionByNameOrId(name)
		if err != nil {
			t.Fatal(err)
		}
		return c
	}

	// Create a site with two designed controllers and three nodes.
	sitesColl := coll("sites")
	site := core.NewRecord(sitesColl)
	site.Set("name", "Test")
	site.Set("draft_topology", map[string]any{
		"schema":      1,
		"controllers": []any{map[string]any{"id": "c1"}, map[string]any{"id": "c2"}},
		"nodes":       []any{map[string]any{"id": "n1"}, map[string]any{"id": "n2"}, map[string]any{"id": "n3"}},
	})
	if err := app.Save(site); err != nil {
		t.Fatalf("create site failed: %v", err)
	}
	if site.GetInt("controller_count") != 2 {
		t.Errorf("controller_count after create = %d, want 2", site.GetInt("controller_count"))
	}
	if site.GetInt("node_count") != 3 {
		t.Errorf("node_count after create = %d, want 3", site.GetInt("node_count"))
	}

	// Add an active, seen controller — device_count and live_count should update.
	ctrlsColl := coll("controllers")
	ctrl := core.NewRecord(ctrlsColl)
	ctrl.Id = "ctrl1"
	ctrl.Set("site", site.Id)
	ctrl.Set("active", true)
	ctrl.Set("last_seen", "2026-07-09T10:00:00Z")
	if err := app.Save(ctrl); err != nil {
		t.Fatalf("create controller failed: %v", err)
	}

	site, err = app.FindRecordById("sites", site.Id)
	if err != nil {
		t.Fatal(err)
	}
	if site.GetInt("device_count") != 1 {
		t.Errorf("device_count after controller create = %d, want 1", site.GetInt("device_count"))
	}
	if site.GetInt("live_count") != 1 {
		t.Errorf("live_count after controller create = %d, want 1", site.GetInt("live_count"))
	}

	// Mark the controller inactive — device_count drops, live_count stays because last_seen remains.
	ctrl.Set("active", false)
	if err := app.Save(ctrl); err != nil {
		t.Fatalf("update controller failed: %v", err)
	}
	site, err = app.FindRecordById("sites", site.Id)
	if err != nil {
		t.Fatal(err)
	}
	if site.GetInt("device_count") != 0 {
		t.Errorf("device_count after deactivate = %d, want 0", site.GetInt("device_count"))
	}
	if site.GetInt("live_count") != 1 {
		t.Errorf("live_count after deactivate = %d, want 1", site.GetInt("live_count"))
	}

	// Update the site's topology to add a controller.
	site.Set("draft_topology", map[string]any{
		"schema":      1,
		"controllers": []any{map[string]any{"id": "c1"}, map[string]any{"id": "c2"}, map[string]any{"id": "c3"}},
		"nodes":       []any{map[string]any{"id": "n1"}},
	})
	if err := app.Save(site); err != nil {
		t.Fatalf("update site topology failed: %v", err)
	}
	if site.GetInt("controller_count") != 3 {
		t.Errorf("controller_count after topology update = %d, want 3", site.GetInt("controller_count"))
	}
	if site.GetInt("node_count") != 1 {
		t.Errorf("node_count after topology update = %d, want 1", site.GetInt("node_count"))
	}
}

// Regression: site creation through the public PocketBase API must succeed with the
// same payload the Angular frontend sends. A missing collection or broken create rule
// surfaces as a 404 "The requested resource wasn't found" in the UI.
func TestSiteCreateViaAPI(t *testing.T) {
	app, err := tests.NewTestApp()
	if err != nil {
		t.Fatal(err)
	}
	defer app.Cleanup()

	registerSiteHooks(app, config.Config{Mode: config.ModeCloud})

	users, _ := app.FindCollectionByNameOrId("users")
	admin := core.NewRecord(users)
	admin.Set("email", "admin@x.com")
	admin.Set("password", "password123")
	admin.Set("role", "admin")
	admin.Set("verified", true)
	if err := app.Save(admin); err != nil {
		t.Fatal(err)
	}

	tok, err := admin.NewAuthToken()
	if err != nil {
		t.Fatal(err)
	}

	body, _ := json.Marshal(map[string]any{
		"name":           "Riverside",
		"slug":           "riverside",
		"draft_topology": map[string]any{"schema": 1, "controllers": []any{}, "nodes": []any{}},
		"owner":          []string{admin.Id},
	})

	scenario := tests.ApiScenario{
		Name:           "admin creates site",
		Method:         http.MethodPost,
		URL:            "/api/collections/sites/records",
		Body:           bytes.NewReader(body),
		Headers:        map[string]string{"Content-Type": "application/json", "Authorization": tok},
		ExpectedStatus: 200,
		TestAppFactory: func(t testing.TB) *tests.TestApp { return app },
	}
	scenario.Test(t)
}
