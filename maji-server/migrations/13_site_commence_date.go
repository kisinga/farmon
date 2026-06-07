package migrations

import (
	"github.com/pocketbase/pocketbase/core"
	m "github.com/pocketbase/pocketbase/migrations"
)

// Sites gain a `commence_date`: the moment hosting began, stamped once when the
// site's first controller is provisioned on a managed (hosted) site. It anchors
// the yearly hosting-fee clock; on-prem (local) sites never get one. Stamped
// server-side at /provision and never reset by later provisions.
func init() {
	m.Register(func(app core.App) error {
		c, err := app.FindCollectionByNameOrId("sites")
		if err != nil {
			return err
		}
		c.Fields.Add(&core.DateField{Name: "commence_date"})
		return app.Save(c)
	}, func(app core.App) error {
		c, err := app.FindCollectionByNameOrId("sites")
		if err != nil {
			return err
		}
		c.Fields.RemoveByName("commence_date")
		return app.Save(c)
	})
}
