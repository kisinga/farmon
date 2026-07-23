package api_test

import (
	"net/http"
	"testing"

	"github.com/kisinga/majiflow/internal/api"
	_ "github.com/kisinga/majiflow/migrations"
	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tests"
)

// capabilitiesSeed builds a site (id site11111111111) entitled via one addon
// and one pack, plus an owner, an admin, and an unrelated customer; it returns
// their auth tokens.
func capabilitiesSeed(t testing.TB, app core.App) (ownerTok, adminTok, strangerTok string) {
	t.Helper()
	save := func(r *core.Record) {
		if err := app.Save(r); err != nil {
			t.Fatal(err)
		}
	}
	rec := func(coll string) *core.Record {
		c, err := app.FindCollectionByNameOrId(coll)
		if err != nil {
			t.Fatal(err)
		}
		return core.NewRecord(c)
	}
	mkUser := func(email, role string) *core.Record {
		u := rec("users")
		u.Set("email", email)
		u.Set("password", "password123")
		u.Set("role", role)
		u.Set("verified", true)
		save(u)
		return u
	}
	token := func(u *core.Record) string {
		tok, err := u.NewAuthToken()
		if err != nil {
			t.Fatal(err)
		}
		return tok
	}

	owner := mkUser("owner@x.com", "customer")
	admin := mkUser("caps-admin@x.com", "admin")
	stranger := mkUser("stranger@x.com", "customer")

	pack := rec("packs")
	pack.Set("key", "billing-pack")
	pack.Set("capabilities", []string{"tenant_billing"})
	pack.Set("widget_ids", []string{"billing.summary"})
	save(pack)

	site := rec("sites")
	site.Id = "site11111111111"
	site.Set("name", "Caps Site")
	site.Set("owner", []string{owner.Id})
	site.Set("addons", []string{"alerts"})
	site.Set("packs", []string{pack.Id})
	save(site)

	return token(owner), token(admin), token(stranger)
}

func capabilitiesScenario(t *testing.T, name, authHeader string, status int, content []string) {
	t.Helper()
	capabilitiesScenarioURL(t, name, authHeader, "/api/farmon/sites/site11111111111/capabilities", status, content)
}

func capabilitiesScenarioURL(t *testing.T, name, authHeader, url string, status int, content []string) {
	t.Helper()
	headers := map[string]string{}
	scenario := tests.ApiScenario{
		Name:            name,
		Method:          http.MethodGet,
		URL:             url,
		Headers:         headers,
		ExpectedStatus:  status,
		ExpectedContent: content,
		TestAppFactory: func(t testing.TB) *tests.TestApp {
			app, err := tests.NewTestApp()
			if err != nil {
				t.Fatal(err)
			}
			return app
		},
		BeforeTestFunc: func(t testing.TB, app *tests.TestApp, e *core.ServeEvent) {
			ownerTok, adminTok, strangerTok := capabilitiesSeed(t, app)
			switch authHeader {
			case "owner":
				headers["Authorization"] = ownerTok
			case "admin":
				headers["Authorization"] = adminTok
			case "stranger":
				headers["Authorization"] = strangerTok
			}
			api.RegisterCapabilities(e)
		},
	}
	scenario.Test(t)
}

// The owner gets the resolved union (site.addons ∪ packs.capabilities), sorted.
func TestCapabilitiesOwnerGetsSet(t *testing.T) {
	capabilitiesScenario(t, "owner gets capabilities", "owner", 200,
		[]string{`"capabilities":["alerts","tenant_billing"]`, `"widget_ids":["billing.summary"]`})
}

// Admins bypass ownership and get the same payload.
func TestCapabilitiesAdminGetsSet(t *testing.T) {
	capabilitiesScenario(t, "admin gets capabilities", "admin", 200,
		[]string{`"capabilities":["alerts","tenant_billing"]`})
}

// No session → 401 before any entitlement data leaks.
func TestCapabilitiesRequiresAuth(t *testing.T) {
	capabilitiesScenario(t, "unauthenticated is rejected", "", 401,
		[]string{"Authentication required"})
}

// A customer who doesn't own the site gets 403.
func TestCapabilitiesRejectsNonOwner(t *testing.T) {
	capabilitiesScenario(t, "non-owner customer is forbidden", "stranger", 403,
		[]string{"You do not own this site"})
}

// The auth check runs before any site-existence probe: an unauthenticated
// caller asking about a site id that doesn't exist gets 401, not 404 — the
// response must not reveal whether a site id is valid.
func TestCapabilitiesUnauthCannotProbeSiteIds(t *testing.T) {
	capabilitiesScenarioURL(t, "unauthenticated nonexistent site is 401", "",
		"/api/farmon/sites/nope1111111111/capabilities", 401,
		[]string{"Authentication required"})
}

// An authenticated owner asking about a missing site still gets 404.
func TestCapabilitiesMissingSite404(t *testing.T) {
	capabilitiesScenarioURL(t, "owner nonexistent site is 404", "owner",
		"/api/farmon/sites/nope1111111111/capabilities", 404,
		[]string{"Site not found"})
}
