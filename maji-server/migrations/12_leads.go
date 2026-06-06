package migrations

import (
	"github.com/pocketbase/pocketbase/core"
	m "github.com/pocketbase/pocketbase/migrations"
	"github.com/pocketbase/pocketbase/tools/types"
)

// `leads` — sales enquiries captured (consent-gated) from the public pricing
// estimator. Anyone may create one (the marketing form is unauthenticated);
// only admins read or manage them. The `estimate` JSON snapshots what the
// visitor configured so followup has context. The `hp` honeypot field plus the
// server-side create hook (see internal/server) drop obvious bot spam, and the
// hook refuses to store a lead without consent.
func init() {
	m.Register(func(app core.App) error {
		c := core.NewBaseCollection("leads")
		c.Fields.Add(
			&core.TextField{Name: "name", Required: true, Max: 200},
			&core.TextField{Name: "phone", Max: 60},
			&core.EmailField{Name: "email"},
			&core.BoolField{Name: "consent"},
			&core.JSONField{Name: "estimate", MaxSize: 100_000},
			&core.TextField{Name: "source", Max: 60},
			&core.TextField{Name: "hp", Max: 200}, // honeypot — legit submitters leave it empty
			&core.AutodateField{Name: "created", OnCreate: true},
		)

		// Public create (the marketing form has no auth); admin-only for the rest.
		// A nil rule would lock the collection to superusers; the empty string
		// opens it to anyone, which is what a public lead form needs.
		public := types.Pointer("")
		adminOnly := types.Pointer(`@request.auth.role = "admin"`)
		c.CreateRule = public
		c.ListRule = adminOnly
		c.ViewRule = adminOnly
		c.UpdateRule = adminOnly
		c.DeleteRule = adminOnly

		return app.Save(c)
	}, func(app core.App) error {
		c, err := app.FindCollectionByNameOrId("leads")
		if err != nil {
			return err
		}
		return app.Delete(c)
	})
}
