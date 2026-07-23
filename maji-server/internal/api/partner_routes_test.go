package api_test

import (
	"bytes"
	"encoding/json"
	"io"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/kisinga/majiflow/internal/api"
	"github.com/kisinga/majiflow/internal/config"
	_ "github.com/kisinga/majiflow/migrations"
	"github.com/pocketbase/pocketbase/apis"
	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tests"
)

// partnerSeed builds two partner orgs with one partner user each, plus a
// customer of org A, a plain (org-less) customer, and an org-less partner user.
// It returns the records and a token helper.
type partnerSeedData struct {
	orgA, orgB         *core.Record
	partnerA, partnerB *core.Record
	customerA          *core.Record // role=customer, partner=orgA
	plainCustomer      *core.Record // role=customer, no org
	orglessPartner     *core.Record // role=partner, no org assigned
}

func seedPartners(t testing.TB, app core.App) *partnerSeedData {
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
	mkOrg := func(name, slug string) *core.Record {
		org := rec("partners")
		org.Set("name", name)
		org.Set("slug", slug)
		org.Set("brand_primary", "#112233")
		org.Set("brand_accent", "#445566")
		save(org)
		return org
	}
	mkUser := func(email, role, partner string) *core.Record {
		u := rec("users")
		u.Set("email", email)
		u.Set("password", "password123")
		u.Set("role", role)
		u.Set("verified", true)
		if partner != "" {
			u.Set("partner", partner)
		}
		save(u)
		return u
	}

	d := &partnerSeedData{}
	d.orgA = mkOrg("Acme Water", "acme-water")
	d.orgB = mkOrg("Beta Irrigation", "beta-irrigation")
	d.partnerA = mkUser("partner-a@x.com", "partner", d.orgA.Id)
	d.partnerB = mkUser("partner-b@x.com", "partner", d.orgB.Id)
	d.customerA = mkUser("cust-a@x.com", "customer", d.orgA.Id)
	d.plainCustomer = mkUser("plain@x.com", "customer", "")
	d.orglessPartner = mkUser("orgless@x.com", "partner", "")
	return d
}

func partnerToken(t testing.TB, u *core.Record) string {
	t.Helper()
	tok, err := u.NewAuthToken()
	if err != nil {
		t.Fatal(err)
	}
	return tok
}

// tinyPNG is a valid 1x1 transparent PNG — the partners.logo FileField sniffs
// real content on save, so a mislabelled payload must fail even at the
// endpoint's happy path.
var tinyPNG = []byte{
	0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0x00, 0x00, 0x00, 0x0D,
	0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
	0x08, 0x06, 0x00, 0x00, 0x00, 0x1F, 0x15, 0xC4, 0x89, 0x00, 0x00, 0x00,
	0x0D, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9C, 0x62, 0x00, 0x01, 0x00, 0x00,
	0x05, 0x00, 0x01, 0x0D, 0x0A, 0x2D, 0xB4, 0x00, 0x00, 0x00, 0x00, 0x49,
	0x45, 0x4E, 0x44, 0xAE, 0x42, 0x60, 0x82,
}

func partnerScenario(t *testing.T, scenario tests.ApiScenario) {
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
		api.RegisterPartner(e)
	}
	scenario.Test(t)
}

// Gate 1: a partner reads their own org through the self-serve endpoint.
func TestPartnerOrgGet(t *testing.T) {
	headers := map[string]string{}
	partnerScenario(t, tests.ApiScenario{
		Name:           "partner reads own org",
		Method:         http.MethodGet,
		URL:            "/api/farmon/partner/org",
		Headers:        headers,
		ExpectedStatus: 200,
		ExpectedContent: []string{
			`"name":"Acme Water"`, `"slug":"acme-water"`,
			`"brand_primary":"#112233"`, `"brand_accent":"#445566"`,
		},
		BeforeTestFunc: func(t testing.TB, app *tests.TestApp, _ *core.ServeEvent) {
			d := seedPartners(t, app)
			headers["Authorization"] = partnerToken(t, d.partnerA)
		},
	})
}

// The org is resolved from auth, so partner B can never see org A's record.
func TestPartnerOrgGetScopesToCaller(t *testing.T) {
	headers := map[string]string{}
	partnerScenario(t, tests.ApiScenario{
		Name:           "partner B gets org B, never org A",
		Method:         http.MethodGet,
		URL:            "/api/farmon/partner/org",
		Headers:        headers,
		ExpectedStatus: 200,
		ExpectedContent: []string{
			`"name":"Beta Irrigation"`, `"slug":"beta-irrigation"`,
		},
		BeforeTestFunc: func(t testing.TB, app *tests.TestApp, _ *core.ServeEvent) {
			d := seedPartners(t, app)
			headers["Authorization"] = partnerToken(t, d.partnerB)
		},
	})
}

func TestPartnerOrgRequiresAuth(t *testing.T) {
	partnerScenario(t, tests.ApiScenario{
		Name:            "unauthenticated is rejected",
		Method:          http.MethodGet,
		URL:             "/api/farmon/partner/org",
		ExpectedStatus:  401,
		ExpectedContent: []string{"Authentication required"},
	})
}

// Gate 1: a customer role cannot call /partner/org.
func TestPartnerOrgRejectsCustomer(t *testing.T) {
	headers := map[string]string{}
	partnerScenario(t, tests.ApiScenario{
		Name:            "customer role is forbidden",
		Method:          http.MethodGet,
		URL:             "/api/farmon/partner/org",
		Headers:         headers,
		ExpectedStatus:  403,
		ExpectedContent: []string{"Partner role required"},
		BeforeTestFunc: func(t testing.TB, app *tests.TestApp, _ *core.ServeEvent) {
			d := seedPartners(t, app)
			headers["Authorization"] = partnerToken(t, d.customerA)
		},
	})
}

func TestPartnerOrgNotAssigned(t *testing.T) {
	headers := map[string]string{}
	partnerScenario(t, tests.ApiScenario{
		Name:            "partner without an org gets 404",
		Method:          http.MethodGet,
		URL:             "/api/farmon/partner/org",
		Headers:         headers,
		ExpectedStatus:  404,
		ExpectedContent: []string{"No partner organization assigned"},
		BeforeTestFunc: func(t testing.TB, app *tests.TestApp, _ *core.ServeEvent) {
			d := seedPartners(t, app)
			headers["Authorization"] = partnerToken(t, d.orglessPartner)
		},
	})
}

// Gate 1: a partner updates name + brand colors on their own org.
func TestPartnerOrgPatch(t *testing.T) {
	headers := map[string]string{"Content-Type": "application/json"}
	var orgAID string
	partnerScenario(t, tests.ApiScenario{
		Name:           "partner patches own org",
		Method:         http.MethodPatch,
		URL:            "/api/farmon/partner/org",
		Body:           strings.NewReader(`{"name":"Acme Water Ltd","brand_primary":"#aabbcc","brand_accent":""}`),
		Headers:        headers,
		ExpectedStatus: 200,
		ExpectedContent: []string{
			`"name":"Acme Water Ltd"`, `"brand_primary":"#aabbcc"`, `"brand_accent":""`,
			`"slug":"acme-water"`, // slug is not editable through this surface
		},
		BeforeTestFunc: func(t testing.TB, app *tests.TestApp, _ *core.ServeEvent) {
			d := seedPartners(t, app)
			orgAID = d.orgA.Id
			headers["Authorization"] = partnerToken(t, d.partnerA)
		},
		AfterTestFunc: func(t testing.TB, app *tests.TestApp, _ *http.Response) {
			org, err := app.FindRecordById("partners", orgAID)
			if err != nil {
				t.Fatal(err)
			}
			if org.GetString("name") != "Acme Water Ltd" || org.GetString("brand_primary") != "#aabbcc" {
				t.Fatalf("patch not persisted: name=%q primary=%q", org.GetString("name"), org.GetString("brand_primary"))
			}
			if org.GetString("brand_accent") != "" {
				t.Fatalf("empty brand_accent should clear the override, got %q", org.GetString("brand_accent"))
			}
		},
	})
}

func TestPartnerOrgPatchRejectsBadColor(t *testing.T) {
	headers := map[string]string{"Content-Type": "application/json"}
	partnerScenario(t, tests.ApiScenario{
		Name:            "non-hex color is rejected",
		Method:          http.MethodPatch,
		URL:             "/api/farmon/partner/org",
		Body:            strings.NewReader(`{"brand_primary":"red"}`),
		Headers:         headers,
		ExpectedStatus:  400,
		ExpectedContent: []string{"rand_primary must be a #rrggbb hex color"},
		BeforeTestFunc: func(t testing.TB, app *tests.TestApp, _ *core.ServeEvent) {
			d := seedPartners(t, app)
			headers["Authorization"] = partnerToken(t, d.partnerA)
		},
	})
}

func TestPartnerOrgPatchRejectsEmptyName(t *testing.T) {
	headers := map[string]string{"Content-Type": "application/json"}
	partnerScenario(t, tests.ApiScenario{
		Name:            "empty name is rejected",
		Method:          http.MethodPatch,
		URL:             "/api/farmon/partner/org",
		Body:            strings.NewReader(`{"name":"  "}`),
		Headers:         headers,
		ExpectedStatus:  400,
		ExpectedContent: []string{"ame cannot be empty"},
		BeforeTestFunc: func(t testing.TB, app *tests.TestApp, _ *core.ServeEvent) {
			d := seedPartners(t, app)
			headers["Authorization"] = partnerToken(t, d.partnerA)
		},
	})
}

func logoUploadBody(t testing.TB, contentType, filename string, data []byte) (*bytes.Buffer, string) {
	t.Helper()
	var body bytes.Buffer
	w := multipart.NewWriter(&body)
	h := map[string][]string{"Content-Disposition": {`form-data; name="logo"; filename="` + filename + `"`}, "Content-Type": {contentType}}
	part, err := w.CreatePart(h)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := part.Write(data); err != nil {
		t.Fatal(err)
	}
	if err := w.Close(); err != nil {
		t.Fatal(err)
	}
	return &body, w.FormDataContentType()
}

// Gate 1: logo upload happy path — stored on the caller's own org, URL returned.
func TestPartnerOrgLogoUpload(t *testing.T) {
	headers := map[string]string{}
	body, ct := logoUploadBody(t, "image/png", "logo.png", tinyPNG)
	headers["Content-Type"] = ct
	var orgAID string
	partnerScenario(t, tests.ApiScenario{
		Name:            "partner uploads a logo",
		Method:          http.MethodPost,
		URL:             "/api/farmon/partner/org/logo",
		Body:            body,
		Headers:         headers,
		ExpectedStatus:  200,
		ExpectedContent: []string{`"logo_url":"/api/files/`},
		BeforeTestFunc: func(t testing.TB, app *tests.TestApp, _ *core.ServeEvent) {
			d := seedPartners(t, app)
			orgAID = d.orgA.Id
			headers["Authorization"] = partnerToken(t, d.partnerA)
		},
		AfterTestFunc: func(t testing.TB, app *tests.TestApp, _ *http.Response) {
			org, err := app.FindRecordById("partners", orgAID)
			if err != nil {
				t.Fatal(err)
			}
			if org.GetString("logo") == "" {
				t.Fatal("logo was not stored on the org record")
			}
		},
	})
}

// Gate 1: an oversize logo is rejected by the endpoint's own byte count.
func TestPartnerOrgLogoRejectsOversize(t *testing.T) {
	headers := map[string]string{}
	body, ct := logoUploadBody(t, "image/png", "big.png", make([]byte, 2*1024*1024+1))
	headers["Content-Type"] = ct
	partnerScenario(t, tests.ApiScenario{
		Name:            "logo over 2 MB is rejected",
		Method:          http.MethodPost,
		URL:             "/api/farmon/partner/org/logo",
		Body:            body,
		Headers:         headers,
		ExpectedStatus:  400,
		ExpectedContent: []string{"exceeds the 2 MB limit"},
		BeforeTestFunc: func(t testing.TB, app *tests.TestApp, _ *core.ServeEvent) {
			d := seedPartners(t, app)
			headers["Authorization"] = partnerToken(t, d.partnerA)
		},
	})
}

// Gate 1: a non-image upload is rejected on the declared content type.
func TestPartnerOrgLogoRejectsNonImage(t *testing.T) {
	headers := map[string]string{}
	body, ct := logoUploadBody(t, "text/plain", "notes.txt", []byte("not an image"))
	headers["Content-Type"] = ct
	partnerScenario(t, tests.ApiScenario{
		Name:            "non-image logo is rejected",
		Method:          http.MethodPost,
		URL:             "/api/farmon/partner/org/logo",
		Body:            body,
		Headers:         headers,
		ExpectedStatus:  400,
		ExpectedContent: []string{"ust be a jpeg, png or webp image"},
		BeforeTestFunc: func(t testing.TB, app *tests.TestApp, _ *core.ServeEvent) {
			d := seedPartners(t, app)
			headers["Authorization"] = partnerToken(t, d.partnerA)
		},
	})
}

// Gate 1: SVG is rejected even though the partners.logo FileField (admin-only
// path) allows it — /api/files serves uploads inline on the API origin, so an
// SVG logo opened directly would run script in the SPA origin (stored XSS).
func TestPartnerOrgLogoRejectsSVG(t *testing.T) {
	headers := map[string]string{}
	svg := []byte(`<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>`)
	body, ct := logoUploadBody(t, "image/svg+xml", "logo.svg", svg)
	headers["Content-Type"] = ct
	partnerScenario(t, tests.ApiScenario{
		Name:            "svg logo is rejected",
		Method:          http.MethodPost,
		URL:             "/api/farmon/partner/org/logo",
		Body:            body,
		Headers:         headers,
		ExpectedStatus:  400,
		ExpectedContent: []string{"ust be a jpeg, png or webp image"},
		BeforeTestFunc: func(t testing.TB, app *tests.TestApp, _ *core.ServeEvent) {
			d := seedPartners(t, app)
			headers["Authorization"] = partnerToken(t, d.partnerA)
		},
	})
}

func TestPartnerOrgLogoRejectsCustomer(t *testing.T) {
	headers := map[string]string{}
	body, ct := logoUploadBody(t, "image/png", "logo.png", tinyPNG)
	headers["Content-Type"] = ct
	partnerScenario(t, tests.ApiScenario{
		Name:            "customer cannot upload a logo",
		Method:          http.MethodPost,
		URL:             "/api/farmon/partner/org/logo",
		Body:            body,
		Headers:         headers,
		ExpectedStatus:  403,
		ExpectedContent: []string{"Partner role required"},
		BeforeTestFunc: func(t testing.TB, app *tests.TestApp, _ *core.ServeEvent) {
			d := seedPartners(t, app)
			headers["Authorization"] = partnerToken(t, d.customerA)
		},
	})
}

// Gate 2: a partner sees notification_incidents only for sites whose partner
// set contains their org. Seed: one incident on an org-A site, one on an
// org-B site — the partner-A list must contain exactly the org-A one.
func TestPartnerIncidentListScopedToOrg(t *testing.T) {
	headers := map[string]string{}
	partnerScenario(t, tests.ApiScenario{
		Name:           "partner lists only their org's incidents",
		Method:         http.MethodGet,
		URL:            "/api/collections/notification_incidents/records",
		Headers:        headers,
		ExpectedStatus: 200,
		ExpectedContent: []string{
			`"totalItems":1`, `"incident_key":"site-a:dev1:device_offline"`,
		},
		BeforeTestFunc: func(t testing.TB, app *tests.TestApp, _ *core.ServeEvent) {
			d := seedPartners(t, app)
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
			mkSite := func(name string, owner *core.Record, org *core.Record) *core.Record {
				s := rec("sites")
				s.Set("name", name)
				s.Set("owner", []string{owner.Id})
				s.Set("partner", []string{org.Id})
				save(s)
				return s
			}
			custB := rec("users")
			custB.Set("email", "cust-b@x.com")
			custB.Set("password", "password123")
			custB.Set("role", "customer")
			custB.Set("verified", true)
			custB.Set("partner", d.orgB.Id)
			save(custB)

			siteA := mkSite("A Site", d.customerA, d.orgA)
			siteB := mkSite("B Site", custB, d.orgB)

			mkIncident := func(site *core.Record, key string) {
				i := rec("notification_incidents")
				i.Set("site", site.Id)
				i.Set("incident_key", key)
				i.Set("kind", "device_offline")
				i.Set("status", "active")
				save(i)
			}
			mkIncident(siteA, "site-a:dev1:device_offline")
			mkIncident(siteB, "site-b:dev2:device_offline")

			headers["Authorization"] = partnerToken(t, d.partnerA)
		},
	})
}

// Gate 2 (customer regression): the site owner still reads their site's
// incidents through the owner clause, unaffected by the partner additions.
func TestCustomerIncidentListUnaffected(t *testing.T) {
	headers := map[string]string{}
	partnerScenario(t, tests.ApiScenario{
		Name:           "site owner lists their incidents",
		Method:         http.MethodGet,
		URL:            "/api/collections/notification_incidents/records",
		Headers:        headers,
		ExpectedStatus: 200,
		ExpectedContent: []string{
			`"totalItems":1`, `"incident_key":"site-a:dev1:tank_low"`,
		},
		BeforeTestFunc: func(t testing.TB, app *tests.TestApp, _ *core.ServeEvent) {
			d := seedPartners(t, app)
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
			// Another customer of the SAME org with their own site + incident:
			// the owner clause must not leak it to customer A (and the 63 role
			// guard keeps the partner clause from doing so either).
			custA2 := rec("users")
			custA2.Set("email", "cust-a2@x.com")
			custA2.Set("password", "password123")
			custA2.Set("role", "customer")
			custA2.Set("verified", true)
			custA2.Set("partner", d.orgA.Id)
			save(custA2)

			mkSite := func(name string, owner *core.Record) *core.Record {
				s := rec("sites")
				s.Set("name", name)
				s.Set("owner", []string{owner.Id})
				s.Set("partner", []string{d.orgA.Id})
				save(s)
				return s
			}
			siteA := mkSite("A Site", d.customerA)
			siteA2 := mkSite("A2 Site", custA2)

			mkIncident := func(site *core.Record, key string) {
				i := rec("notification_incidents")
				i.Set("site", site.Id)
				i.Set("incident_key", key)
				i.Set("kind", "tank_low")
				i.Set("status", "active")
				save(i)
			}
			mkIncident(siteA, "site-a:dev1:tank_low")
			mkIncident(siteA2, "site-a2:dev9:tank_low")

			headers["Authorization"] = partnerToken(t, d.customerA)
		},
	})
}

// Gate 3: the customer-onboarding wizard's backend path end to end — the
// partner creates a customer through the guarded collection write, the
// customer authenticates, and their sites list shows only their own site
// (not another customer of the same org, not another org's site).
//
// One mux serves every step: ApiScenario rebuilds the router per scenario and
// a second apis.NewRouter on the same app double-binds the OnServe hooks, so
// the steps share a manually built mux (the same construction ApiScenario
// uses) and fire sequential requests against it.
func TestPartnerWizardEndToEnd(t *testing.T) {
	app, err := tests.NewTestApp()
	if err != nil {
		t.Fatal(err)
	}
	defer app.Cleanup()

	d := seedPartners(t, app)
	partnerTok := partnerToken(t, d.partnerA)

	// The PocketBase test fixture ships users with MFA on (Enabled, 1800s); the
	// production schema (migration 02, NewAuthCollection defaults) has it off.
	// Match production so the password-login step doesn't stop at an OTP prompt.
	usersColl, err := app.FindCollectionByNameOrId("users")
	if err != nil {
		t.Fatal(err)
	}
	usersColl.MFA.Enabled = false
	if err := app.Save(usersColl); err != nil {
		t.Fatal(err)
	}

	// Another customer of org A with their own site — must stay invisible.
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
	other := rec("users")
	other.Set("email", "other-cust@x.com")
	other.Set("password", "password123")
	other.Set("role", "customer")
	other.Set("verified", true)
	other.Set("partner", d.orgA.Id)
	save(other)
	otherSite := rec("sites")
	otherSite.Set("name", "Other Cust Site")
	otherSite.Set("owner", []string{other.Id})
	otherSite.Set("partner", []string{d.orgA.Id})
	save(otherSite)

	baseRouter, err := apis.NewRouter(app)
	if err != nil {
		t.Fatal(err)
	}
	serveEvent := new(core.ServeEvent)
	serveEvent.App = app
	serveEvent.Router = baseRouter
	var mux http.Handler
	if err := app.OnServe().Trigger(serveEvent, func(e *core.ServeEvent) error {
		var err error
		mux, err = e.Router.BuildMux()
		return err
	}); err != nil {
		t.Fatal(err)
	}

	do := func(method, url, token string, body io.Reader) *httptest.ResponseRecorder {
		req := httptest.NewRequest(method, url, body)
		req.Header.Set("Content-Type", "application/json")
		if token != "" {
			req.Header.Set("Authorization", token)
		}
		rec := httptest.NewRecorder()
		mux.ServeHTTP(rec, req)
		return rec
	}

	// Step 1: the partner creates the customer (role + partner forced by rule).
	createBody, _ := json.Marshal(map[string]any{
		"name":            "New Customer",
		"email":           "new-cust@x.com",
		"emailVisibility": true,
		"password":        "temp-pass-123",
		"passwordConfirm": "temp-pass-123",
		"role":            "customer",
		"partner":         d.orgA.Id,
	})
	res := do(http.MethodPost, "/api/collections/users/records", partnerTok, bytes.NewReader(createBody))
	if res.Code != 200 {
		t.Fatalf("create customer: status = %d, body = %s", res.Code, res.Body.String())
	}
	newCustomer, err := app.FindAuthRecordByEmail("users", "new-cust@x.com")
	if err != nil {
		t.Fatalf("customer not persisted: %v", err)
	}
	if newCustomer.GetString("partner") != d.orgA.Id || newCustomer.GetString("role") != "customer" {
		t.Fatalf("customer partner/role = %q/%q, want org A customer",
			newCustomer.GetString("partner"), newCustomer.GetString("role"))
	}

	// Step 2: the partner creates the customer's first site (owner = customer).
	siteBody, _ := json.Marshal(map[string]any{
		"name":  "New Cust Site",
		"slug":  "new-cust-site",
		"owner": []string{newCustomer.Id},
	})
	res = do(http.MethodPost, "/api/collections/sites/records", partnerTok, bytes.NewReader(siteBody))
	if res.Code != 200 {
		t.Fatalf("create site: status = %d, body = %s", res.Code, res.Body.String())
	}

	// Step 3: the customer logs in with the handoff password.
	res = do(http.MethodPost, "/api/collections/users/auth-with-password", "",
		strings.NewReader(`{"identity":"new-cust@x.com","password":"temp-pass-123"}`))
	if res.Code != 200 {
		t.Fatalf("customer login: status = %d, body = %s", res.Code, res.Body.String())
	}
	var authOut struct {
		Token string `json:"token"`
	}
	if err := json.NewDecoder(res.Body).Decode(&authOut); err != nil || authOut.Token == "" {
		t.Fatalf("no auth token in response: %v", err)
	}

	// Step 4: the customer's sites list shows only their own site.
	res = do(http.MethodGet, "/api/collections/sites/records", authOut.Token, nil)
	if res.Code != 200 {
		t.Fatalf("customer sites list: status = %d, body = %s", res.Code, res.Body.String())
	}
	body := res.Body.String()
	if !strings.Contains(body, `"totalItems":1`) || !strings.Contains(body, `"name":"New Cust Site"`) {
		t.Fatalf("customer should see exactly their own site, got %s", body)
	}
}

// Gate 3 (negative): the partner cannot create a non-customer account or one
// outside their org — the users collection create rule enforces both.
func TestPartnerCannotEscalateUserCreate(t *testing.T) {
	for _, tc := range []struct {
		name string
		body string
	}{
		{"role escalation", `{"email":"x1@x.com","password":"password123","passwordConfirm":"password123","role":"admin"}`},
		{"partner role", `{"email":"x2@x.com","password":"password123","passwordConfirm":"password123","role":"partner"}`},
	} {
		t.Run(tc.name, func(t *testing.T) {
			headers := map[string]string{"Content-Type": "application/json"}
			partnerScenario(t, tests.ApiScenario{
				Name:           "partner create rejected: " + tc.name,
				Method:         http.MethodPost,
				URL:            "/api/collections/users/records",
				Body:           strings.NewReader(tc.body),
				Headers:        headers,
				ExpectedStatus: 400,
				ExpectedContent: []string{
					"Failed to create record",
				},
				BeforeTestFunc: func(t testing.TB, app *tests.TestApp, _ *core.ServeEvent) {
					d := seedPartners(t, app)
					headers["Authorization"] = partnerToken(t, d.partnerA)
				},
			})
		})
	}
}

// Spec §2.2 propagation check: after a partner edits their org through the
// self-serve endpoint, a customer of that org sees the new name/colors through
// the existing /branding endpoint — no code path changes, the same org record
// feeds both. One mux serves both calls (see TestPartnerWizardEndToEnd).
func TestPartnerOrgEditPropagatesToBranding(t *testing.T) {
	app, err := tests.NewTestApp()
	if err != nil {
		t.Fatal(err)
	}
	defer app.Cleanup()

	d := seedPartners(t, app)
	partnerTok := partnerToken(t, d.partnerA)
	customerTok := partnerToken(t, d.customerA)

	baseRouter, err := apis.NewRouter(app)
	if err != nil {
		t.Fatal(err)
	}
	serveEvent := new(core.ServeEvent)
	serveEvent.App = app
	serveEvent.Router = baseRouter
	var mux http.Handler
	if err := app.OnServe().Trigger(serveEvent, func(e *core.ServeEvent) error {
		api.Register(e, config.Config{Mode: config.ModeCloud}, &capturingPublisher{})
		api.RegisterPartner(e)
		var err error
		mux, err = e.Router.BuildMux()
		return err
	}); err != nil {
		t.Fatal(err)
	}

	do := func(method, url, token string, body io.Reader) *httptest.ResponseRecorder {
		req := httptest.NewRequest(method, url, body)
		req.Header.Set("Content-Type", "application/json")
		if token != "" {
			req.Header.Set("Authorization", token)
		}
		rec := httptest.NewRecorder()
		mux.ServeHTTP(rec, req)
		return rec
	}

	res := do(http.MethodPatch, "/api/farmon/partner/org", partnerTok,
		strings.NewReader(`{"name":"Acme Rebranded","brand_primary":"#ff8800"}`))
	if res.Code != 200 {
		t.Fatalf("partner edit: status = %d, body = %s", res.Code, res.Body.String())
	}

	res = do(http.MethodGet, "/api/farmon/branding", customerTok, nil)
	if res.Code != 200 {
		t.Fatalf("customer branding: status = %d, body = %s", res.Code, res.Body.String())
	}
	body := res.Body.String()
	for _, want := range []string{`"name":"Acme Rebranded"`, `"brand_primary":"#ff8800"`, `"brand_accent":"#445566"`} {
		if !strings.Contains(body, want) {
			t.Fatalf("branding missing %s in %s", want, body)
		}
	}
}
