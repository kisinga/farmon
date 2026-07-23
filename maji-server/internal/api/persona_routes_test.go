package api_test

import (
	"net/http"
	"slices"
	"strings"
	"testing"

	"github.com/kisinga/majiflow/internal/api"
	"github.com/kisinga/majiflow/internal/config"
	_ "github.com/kisinga/majiflow/migrations"
	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tests"
)

// personaAllowlist is the allowlist every persona scenario registers with.
var personaAllowlist = []string{"persona@x.com"}

// personaUser seeds a verified user with the given email/role and returns the
// record; personaToken mints its auth token.
func personaUser(t testing.TB, app core.App, email, role string) *core.Record {
	t.Helper()
	c, err := app.FindCollectionByNameOrId("users")
	if err != nil {
		t.Fatal(err)
	}
	u := core.NewRecord(c)
	u.Set("email", email)
	u.Set("password", "password123")
	u.Set("role", role)
	u.Set("verified", true)
	if err := app.Save(u); err != nil {
		t.Fatal(err)
	}
	return u
}

func personaSite(t testing.TB, app core.App, name string, owners []string) *core.Record {
	t.Helper()
	sc, err := app.FindCollectionByNameOrId("sites")
	if err != nil {
		t.Fatal(err)
	}
	site := core.NewRecord(sc)
	site.Set("name", name)
	site.Set("owner", owners)
	if err := app.Save(site); err != nil {
		t.Fatal(err)
	}
	return site
}

// personaScenario registers the persona routes with the standard allowlist.
// The scenario is a pointer so BeforeTestFunc can fill in a Body that depends
// on seeded ids (the request is built after BeforeTestFunc runs).
func personaScenario(t *testing.T, scenario *tests.ApiScenario) {
	t.Helper()
	if scenario.TestAppFactory == nil {
		scenario.TestAppFactory = func(t testing.TB) *tests.TestApp {
			app, err := tests.NewTestApp()
			if err != nil {
				t.Fatal(err)
			}
			return app
		}
	}
	outer := scenario.BeforeTestFunc
	scenario.BeforeTestFunc = func(t testing.TB, app *tests.TestApp, e *core.ServeEvent) {
		if outer != nil {
			outer(t, app, e)
		}
		api.RegisterPersona(e, config.Config{PersonaEmails: personaAllowlist})
	}
	scenario.Test(t)
}

// An allowlisted email gets the probe with its current role.
func TestPersonaProbeAllowed(t *testing.T) {
	headers := map[string]string{}
	personaScenario(t, &tests.ApiScenario{
		Name:            "allowlisted email gets the probe",
		Method:          http.MethodGet,
		URL:             "/api/farmon/persona",
		Headers:         headers,
		ExpectedStatus:  200,
		ExpectedContent: []string{`"enabled":true`, `"role":"admin"`},
		BeforeTestFunc: func(t testing.TB, app *tests.TestApp, _ *core.ServeEvent) {
			u := personaUser(t, app, "persona@x.com", "admin")
			headers["Authorization"] = partnerToken(t, u)
		},
	})
}

// A non-allowlisted user gets 404 on both routes — the feature looks absent.
func TestPersonaProbeDenied(t *testing.T) {
	headers := map[string]string{}
	personaScenario(t, &tests.ApiScenario{
		Name:           "non-allowlisted email gets 404 on the probe",
		Method:         http.MethodGet,
		URL:            "/api/farmon/persona",
		Headers:        headers,
		ExpectedStatus: 404,
		BeforeTestFunc: func(t testing.TB, app *tests.TestApp, _ *core.ServeEvent) {
			u := personaUser(t, app, "other@x.com", "admin")
			headers["Authorization"] = partnerToken(t, u)
		},
	})
}

func TestPersonaSwitchDenied(t *testing.T) {
	headers := map[string]string{"Content-Type": "application/json"}
	personaScenario(t, &tests.ApiScenario{
		Name:           "non-allowlisted email gets 404 on switch",
		Method:         http.MethodPost,
		URL:            "/api/farmon/persona",
		Body:           strings.NewReader(`{"role":"customer"}`),
		Headers:        headers,
		ExpectedStatus: 404,
		BeforeTestFunc: func(t testing.TB, app *tests.TestApp, _ *core.ServeEvent) {
			u := personaUser(t, app, "other@x.com", "admin")
			headers["Authorization"] = partnerToken(t, u)
		},
	})
}

// An unset allowlist disables the feature even for an authenticated admin.
func TestPersonaDisabledWithoutAllowlist(t *testing.T) {
	headers := map[string]string{}
	var scenario tests.ApiScenario
	scenario = tests.ApiScenario{
		Name:           "empty allowlist answers 404",
		Method:         http.MethodGet,
		URL:            "/api/farmon/persona",
		Headers:        headers,
		ExpectedStatus: 404,
		TestAppFactory: func(t testing.TB) *tests.TestApp {
			app, err := tests.NewTestApp()
			if err != nil {
				t.Fatal(err)
			}
			return app
		},
		BeforeTestFunc: func(t testing.TB, app *tests.TestApp, e *core.ServeEvent) {
			u := personaUser(t, app, "persona@x.com", "admin")
			headers["Authorization"] = partnerToken(t, u)
			api.RegisterPersona(e, config.Config{})
		},
	}
	scenario.Test(t)
}

// Switching to partner sets the role and the org relation on the caller.
func TestPersonaSwitchToPartner(t *testing.T) {
	headers := map[string]string{"Content-Type": "application/json"}
	var userID, orgID string
	var scenario tests.ApiScenario
	scenario = tests.ApiScenario{
		Name:           "admin switches to partner with an org",
		Method:         http.MethodPost,
		URL:            "/api/farmon/persona",
		Headers:        headers,
		ExpectedStatus: 200,
		BeforeTestFunc: func(t testing.TB, app *tests.TestApp, _ *core.ServeEvent) {
			d := seedPartners(t, app)
			u := personaUser(t, app, "persona@x.com", "admin")
			userID, orgID = u.Id, d.orgA.Id
			// The body needs the seeded org id, so build it once the seed exists.
			scenario.Body = strings.NewReader(`{"role":"partner","partner":"` + orgID + `"}`)
			headers["Authorization"] = partnerToken(t, u)
		},
		AfterTestFunc: func(t testing.TB, app *tests.TestApp, _ *http.Response) {
			u, err := app.FindRecordById("users", userID)
			if err != nil {
				t.Fatal(err)
			}
			if u.GetString("role") != "partner" {
				t.Fatalf("role not switched: %q", u.GetString("role"))
			}
			if u.GetString("partner") != orgID {
				t.Fatalf("org not assigned: %q", u.GetString("partner"))
			}
		},
	}
	personaScenario(t, &scenario)
}

// The switch-back path: a caller currently role=customer but in the allowlist
// can switch back to admin (the gate is keyed on email, not role).
func TestPersonaSwitchBackToAdmin(t *testing.T) {
	headers := map[string]string{"Content-Type": "application/json"}
	var userID string
	personaScenario(t, &tests.ApiScenario{
		Name:           "allowlisted customer switches back to admin",
		Method:         http.MethodPost,
		URL:            "/api/farmon/persona",
		Body:           strings.NewReader(`{"role":"admin"}`),
		Headers:        headers,
		ExpectedStatus: 200,
		BeforeTestFunc: func(t testing.TB, app *tests.TestApp, _ *core.ServeEvent) {
			u := personaUser(t, app, "persona@x.com", "customer")
			userID = u.Id
			headers["Authorization"] = partnerToken(t, u)
		},
		AfterTestFunc: func(t testing.TB, app *tests.TestApp, _ *http.Response) {
			u, err := app.FindRecordById("users", userID)
			if err != nil {
				t.Fatal(err)
			}
			if u.GetString("role") != "admin" {
				t.Fatalf("role not switched back: %q", u.GetString("role"))
			}
		},
	})
}

// grant_site=true adds the caller to the site's owner multi-relation.
func TestPersonaGrantSite(t *testing.T) {
	headers := map[string]string{"Content-Type": "application/json"}
	var userID, siteID string
	var scenario tests.ApiScenario
	scenario = tests.ApiScenario{
		Name:           "grant_site adds the caller to site owners",
		Method:         http.MethodPost,
		URL:            "/api/farmon/persona",
		Headers:        headers,
		ExpectedStatus: 200,
		BeforeTestFunc: func(t testing.TB, app *tests.TestApp, _ *core.ServeEvent) {
			u := personaUser(t, app, "persona@x.com", "admin")
			site := personaSite(t, app, "Grant Site", nil)
			userID, siteID = u.Id, site.Id
			scenario.Body = strings.NewReader(`{"role":"customer","site":"` + siteID + `","grant_site":true}`)
			headers["Authorization"] = partnerToken(t, u)
		},
		AfterTestFunc: func(t testing.TB, app *tests.TestApp, _ *http.Response) {
			site, err := app.FindRecordById("sites", siteID)
			if err != nil {
				t.Fatal(err)
			}
			if !slices.Contains(site.GetStringSlice("owner"), userID) {
				t.Fatalf("caller not added to owners: %v", site.GetStringSlice("owner"))
			}
		},
	}
	personaScenario(t, &scenario)
}

// grant_site=false removes the caller from the site's owner multi-relation.
func TestPersonaRevokeSite(t *testing.T) {
	headers := map[string]string{"Content-Type": "application/json"}
	var userID, siteID string
	var scenario tests.ApiScenario
	scenario = tests.ApiScenario{
		Name:           "grant_site=false removes the caller from site owners",
		Method:         http.MethodPost,
		URL:            "/api/farmon/persona",
		Headers:        headers,
		ExpectedStatus: 200,
		BeforeTestFunc: func(t testing.TB, app *tests.TestApp, _ *core.ServeEvent) {
			u := personaUser(t, app, "persona@x.com", "customer")
			site := personaSite(t, app, "Revoke Site", []string{u.Id})
			userID, siteID = u.Id, site.Id
			scenario.Body = strings.NewReader(`{"role":"customer","site":"` + siteID + `","grant_site":false}`)
			headers["Authorization"] = partnerToken(t, u)
		},
		AfterTestFunc: func(t testing.TB, app *tests.TestApp, _ *http.Response) {
			site, err := app.FindRecordById("sites", siteID)
			if err != nil {
				t.Fatal(err)
			}
			if slices.Contains(site.GetStringSlice("owner"), userID) {
				t.Fatalf("caller still an owner: %v", site.GetStringSlice("owner"))
			}
		},
	}
	personaScenario(t, &scenario)
}

func TestPersonaRejectsBadRole(t *testing.T) {
	headers := map[string]string{"Content-Type": "application/json"}
	personaScenario(t, &tests.ApiScenario{
		Name:            "unknown role is a 400",
		Method:          http.MethodPost,
		URL:             "/api/farmon/persona",
		Body:            strings.NewReader(`{"role":"superadmin"}`),
		Headers:         headers,
		ExpectedStatus:  400,
		ExpectedContent: []string{"role must be"},
		BeforeTestFunc: func(t testing.TB, app *tests.TestApp, _ *core.ServeEvent) {
			u := personaUser(t, app, "persona@x.com", "admin")
			headers["Authorization"] = partnerToken(t, u)
		},
	})
}

func TestPersonaRejectsUnknownPartner(t *testing.T) {
	headers := map[string]string{"Content-Type": "application/json"}
	personaScenario(t, &tests.ApiScenario{
		Name:           "unknown org id is a 404",
		Method:         http.MethodPost,
		URL:            "/api/farmon/persona",
		Body:           strings.NewReader(`{"role":"partner","partner":"no_such_org_000"}`),
		Headers:        headers,
		ExpectedStatus: 404,
		BeforeTestFunc: func(t testing.TB, app *tests.TestApp, _ *core.ServeEvent) {
			u := personaUser(t, app, "persona@x.com", "admin")
			headers["Authorization"] = partnerToken(t, u)
		},
	})
}
