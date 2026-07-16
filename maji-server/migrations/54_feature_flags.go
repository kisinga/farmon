package migrations

import (
	"github.com/pocketbase/pocketbase/core"
	m "github.com/pocketbase/pocketbase/migrations"
	"github.com/pocketbase/pocketbase/tools/types"
)

// `feature_flags` — kill-switches for shipping unfinished or reversible work.
// The frontend reads them at bootstrap (public read: flags also gate public
// marketing pages like the pricing assessment) and hides the route + nav link
// when a flag is off; admins flip them in the PocketBase UI — a data edit, not
// a deploy. Seeded with the current set: pricing_page is live, the rest gate
// work that has no UI yet (billing module, partner portal, dashboard rework).
func init() {
	m.Register(func(app core.App) error {
		public := types.Pointer("")
		adminOnly := types.Pointer(`@request.auth.role = "admin"`)
		c := core.NewBaseCollection("feature_flags")
		c.Fields.Add(
			&core.TextField{Name: "key", Required: true, Max: 80},
			&core.BoolField{Name: "enabled"},
			&core.TextField{Name: "description", Max: 300},
			&core.AutodateField{Name: "updated", OnCreate: true, OnUpdate: true},
		)
		c.AddIndex("idx_feature_flags_key", true, "key", "")
		c.ListRule = public
		c.ViewRule = public
		c.CreateRule = adminOnly
		c.UpdateRule = adminOnly
		c.DeleteRule = adminOnly
		if err := app.Save(c); err != nil {
			return err
		}

		seeds := []struct {
			key, desc string
			enabled   bool
		}{
			{"pricing_page", "Public pricing assessment + lead capture.", true},
			{"billing_module", "Customer billing (invoices, payments) — parked; UI not built.", false},
			{"partner_portal", "Self-serve partner view — not built.", false},
			{"new_dashboard", "Dashboard rework — not built.", false},
		}
		for _, s := range seeds {
			rec := core.NewRecord(c)
			rec.Set("key", s.key)
			rec.Set("enabled", s.enabled)
			rec.Set("description", s.desc)
			if err := app.Save(rec); err != nil {
				return err
			}
		}
		return nil
	}, func(app core.App) error {
		c, err := app.FindCollectionByNameOrId("feature_flags")
		if err != nil {
			return err
		}
		return app.Delete(c)
	})
}
