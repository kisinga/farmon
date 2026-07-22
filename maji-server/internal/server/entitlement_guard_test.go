package server

import (
	"bytes"
	"encoding/json"
	"net/http"
	"testing"

	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tests"

	"github.com/kisinga/majiflow/internal/config"
)

// Entitlement fields (addons, packs, price_override) GRANT features, so a site
// owner must not self-grant them — only admins may. Guards live in
// guardEntitlementCreate/Update alongside the owner guards.
func TestEntitlementGuard(t *testing.T) {
	// Each scenario boots its own app: sharing one TestApp across scenarios
	// double-registers routes and panics.
	setup := func(t *testing.T) (app *tests.TestApp, siteID, ownerTok, adminTok string) {
		t.Helper()
		app, err := tests.NewTestApp()
		if err != nil {
			t.Fatal(err)
		}
		t.Cleanup(app.Cleanup)
		registerSiteHooks(app, config.Config{Mode: config.ModeCloud})

		users, _ := app.FindCollectionByNameOrId("users")
		mkUser := func(email, role string) *core.Record {
			u := core.NewRecord(users)
			u.Set("email", email)
			u.Set("password", "password123")
			u.Set("role", role)
			u.Set("verified", true)
			if err := app.Save(u); err != nil {
				t.Fatal(err)
			}
			return u
		}
		owner := mkUser("owner@x.com", "customer")
		admin := mkUser("admin@x.com", "admin")

		sites, _ := app.FindCollectionByNameOrId("sites")
		site := core.NewRecord(sites)
		site.Set("name", "Entitled")
		site.Set("slug", "entitled")
		site.Set("owner", []string{owner.Id})
		if err := app.Save(site); err != nil {
			t.Fatal(err)
		}
		ownerTok, err = owner.NewAuthToken()
		if err != nil {
			t.Fatal(err)
		}
		adminTok, err = admin.NewAuthToken()
		if err != nil {
			t.Fatal(err)
		}
		return app, site.Id, ownerTok, adminTok
	}

	patch := func(t *testing.T, name string, payload map[string]any, useAdmin bool, wantStatus int, wantContent ...string) {
		t.Run(name, func(t *testing.T) {
			app, siteID, ownerTok, adminTok := setup(t)
			tok := ownerTok
			if useAdmin {
				tok = adminTok
			}
			body, _ := json.Marshal(payload)
			scenario := tests.ApiScenario{
				Name:            name,
				Method:          http.MethodPatch,
				URL:             "/api/collections/sites/records/" + siteID,
				Body:            bytes.NewReader(body),
				Headers:         map[string]string{"Content-Type": "application/json", "Authorization": tok},
				ExpectedStatus:  wantStatus,
				ExpectedContent: wantContent,
				TestAppFactory:  func(t testing.TB) *tests.TestApp { return app },
			}
			scenario.Test(t)
		})
	}

	// Owner attempts to self-grant the billing addon → forbidden.
	patch(t, "owner self-grant addon", map[string]any{"addons": []string{"tenant_billing"}}, false, 403, "entitlements")

	// Owner attempts to change price_override → forbidden.
	patch(t, "owner sets price_override", map[string]any{"price_override": 5000}, false, 403, "entitlements")

	// Owner edits a non-entitlement field → allowed (the guard is scoped).
	patch(t, "owner edits thresholds", map[string]any{"tank_low_pct": 30}, false, 200, `"tank_low_pct":30`)

	// Admin grants the addon → allowed and persisted.
	t.Run("admin grants addon", func(t *testing.T) {
		app, siteID, _, adminTok := setup(t)
		body, _ := json.Marshal(map[string]any{"addons": []string{"tenant_billing"}})
		scenario := tests.ApiScenario{
			Name:            "admin grants addon",
			Method:          http.MethodPatch,
			URL:             "/api/collections/sites/records/" + siteID,
			Body:            bytes.NewReader(body),
			Headers:         map[string]string{"Content-Type": "application/json", "Authorization": adminTok},
			ExpectedStatus:  200,
			ExpectedContent: []string{`"tenant_billing"`},
			AfterTestFunc: func(t testing.TB, app *tests.TestApp, res *http.Response) {
				rec, err := app.FindRecordById("sites", siteID)
				if err != nil {
					t.Fatal(err)
				}
				raw, _ := json.Marshal(rec.Get("addons"))
				if string(raw) != `["tenant_billing"]` {
					t.Errorf("addons = %s, want [tenant_billing]", raw)
				}
			},
			TestAppFactory: func(t testing.TB) *tests.TestApp { return app },
		}
		scenario.Test(t)
	})
}
