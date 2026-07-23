package api_test

import (
	"net/http"
	"testing"

	"github.com/kisinga/majiflow/internal/api"
	"github.com/kisinga/majiflow/internal/config"
	_ "github.com/kisinga/majiflow/migrations"
	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tests"
)

// billingSeed builds a site (id site22222222222) co-owned by one customer and
// attached to partner org A, plus a partner user of that org; it returns their
// auth tokens.
func billingSeed(t testing.TB, app core.App) (ownerTok, partnerTok string) {
	t.Helper()
	d := seedPartners(t, app)

	c, err := app.FindCollectionByNameOrId("users")
	if err != nil {
		t.Fatal(err)
	}
	owner := core.NewRecord(c)
	owner.Set("email", "bill-owner@x.com")
	owner.Set("password", "password123")
	owner.Set("role", "customer")
	owner.Set("verified", true)
	if err := app.Save(owner); err != nil {
		t.Fatal(err)
	}

	sc, err := app.FindCollectionByNameOrId("sites")
	if err != nil {
		t.Fatal(err)
	}
	site := core.NewRecord(sc)
	site.Id = "site22222222222"
	site.Set("name", "Billing Site")
	site.Set("owner", []string{owner.Id})
	site.Set("partner", []string{d.orgA.Id})
	if err := app.Save(site); err != nil {
		t.Fatal(err)
	}

	return partnerToken(t, owner), partnerToken(t, d.partnerA)
}

func billingScenario(t *testing.T, name, authHeader string, status int, content []string) {
	t.Helper()
	headers := map[string]string{}
	scenario := tests.ApiScenario{
		Name:            name,
		Method:          http.MethodGet,
		URL:             "/api/farmon/billing/capability?site=site22222222222",
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
			ownerTok, partnerTok := billingSeed(t, app)
			switch authHeader {
			case "owner":
				headers["Authorization"] = ownerTok
			case "partner":
				headers["Authorization"] = partnerTok
			}
			api.RegisterBilling(e, config.Config{})
		},
	}
	scenario.Test(t)
}

// Billing routes are owner-only: a partner of the site's org gets 403 even
// though requireSiteAccess would admit them for non-billing routes.
func TestBillingRejectsPartner(t *testing.T) {
	billingScenario(t, "partner is forbidden on billing routes", "partner", 403,
		[]string{"You do not own this site"})
}

// The site owner passes the ownership gate and gets the capability probe.
func TestBillingAllowsOwner(t *testing.T) {
	billingScenario(t, "owner passes the billing gate", "owner", 200,
		[]string{`"tenant_billing":false`})
}
