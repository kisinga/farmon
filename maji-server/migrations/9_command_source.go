package migrations

import (
	"github.com/pocketbase/pocketbase/core"
	m "github.com/pocketbase/pocketbase/migrations"
)

// commands gains issued_role: the usertype that issued the command ("admin" or
// "customer"), recorded alongside issued_by. KISS provenance so an admin acting
// on a customer's site (after "Take control") is accountable in the same audit
// row, with no separate view-audit collection.
func init() {
	m.Register(func(app core.App) error {
		c, err := app.FindCollectionByNameOrId("commands")
		if err != nil {
			return err
		}
		c.Fields.Add(&core.TextField{Name: "issued_role", Max: 20})
		return app.Save(c)
	}, func(app core.App) error {
		c, err := app.FindCollectionByNameOrId("commands")
		if err != nil {
			return err
		}
		c.Fields.RemoveByName("issued_role")
		return app.Save(c)
	})
}
