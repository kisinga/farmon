package entitlements

import (
	"slices"
	"testing"

	_ "github.com/kisinga/majiflow/migrations"
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

// A site's set is the union of its addons and every related pack's
// capabilities/widget_ids, sorted and deduplicated across overlaps.
func TestSetUnionsAddonsAndPacks(t *testing.T) {
	app := newTestApp(t)

	packA := save(t, app, "packs", map[string]any{
		"key":          "billing-pack",
		"capabilities": []string{"tenant_billing", "dashboard_v2", "tenant_billing"},
		"widget_ids":   []string{"billing.summary", "billing.meters"},
	})
	packB := save(t, app, "packs", map[string]any{
		"key":          "alerts-pack",
		"capabilities": []string{"dashboard_v2", "alerts"},
		"widget_ids":   []string{"billing.meters", "alerts.feed"},
	})
	site := save(t, app, "sites", map[string]any{
		"name":   "Entitlements Site",
		"addons": []string{"onboarding_extra"},
		"packs":  []string{packA.Id, packB.Id},
	})

	caps, widgets, err := Set(app, site.Id)
	if err != nil {
		t.Fatal(err)
	}
	wantCaps := []string{"alerts", "dashboard_v2", "onboarding_extra", "tenant_billing"}
	if !slices.Equal(caps, wantCaps) {
		t.Errorf("capabilities = %v, want %v", caps, wantCaps)
	}
	wantWidgets := []string{"alerts.feed", "billing.meters", "billing.summary"}
	if !slices.Equal(widgets, wantWidgets) {
		t.Errorf("widget_ids = %v, want %v", widgets, wantWidgets)
	}
}

// A dangling pack id in sites.packs is skipped, not fatal.
func TestSetSkipsMissingPack(t *testing.T) {
	app := newTestApp(t)

	pack := save(t, app, "packs", map[string]any{
		"key":          "solo-pack",
		"capabilities": []string{"alerts"},
		"widget_ids":   []string{"alerts.feed"},
	})
	site := save(t, app, "sites", map[string]any{
		"name":  "Dangling Pack Site",
		"packs": []string{pack.Id},
	})
	// Delete the pack after the relation is written, leaving a dangling id.
	if err := app.Delete(pack); err != nil {
		t.Fatal(err)
	}

	caps, widgets, err := Set(app, site.Id)
	if err != nil {
		t.Fatal(err)
	}
	if len(caps) != 0 || len(widgets) != 0 {
		t.Errorf("expected empty sets for a dangling pack, got %v / %v", caps, widgets)
	}
}

// Unknown site ids error out (callers decide how to fail).
func TestSetSiteNotFound(t *testing.T) {
	app := newTestApp(t)

	if _, _, err := Set(app, "nosuchsite0000"); err == nil {
		t.Error("expected an error for a missing site")
	}
}

// A site with no addons and no packs resolves to two empty (non-nil) sets.
func TestSetEmptySite(t *testing.T) {
	app := newTestApp(t)

	site := save(t, app, "sites", map[string]any{"name": "Bare Site"})

	caps, widgets, err := Set(app, site.Id)
	if err != nil {
		t.Fatal(err)
	}
	if caps == nil || widgets == nil {
		t.Error("empty sets must be non-nil (JSON should render [], not null)")
	}
	if len(caps) != 0 || len(widgets) != 0 {
		t.Errorf("expected empty sets, got %v / %v", caps, widgets)
	}
}
