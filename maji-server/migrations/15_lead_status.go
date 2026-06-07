package migrations

import (
	"github.com/pocketbase/pocketbase/core"
	m "github.com/pocketbase/pocketbase/migrations"
)

// Leads gain a `status` so the admin leads view is a real pipeline, not a
// read-only dump: a captured enquiry moves new → contacted → closed. Empty (the
// state of pre-existing rows and fresh public submissions) is treated as "new"
// by the UI; the public create hook never sets it.
func init() {
	m.Register(func(app core.App) error {
		c, err := app.FindCollectionByNameOrId("leads")
		if err != nil {
			return err
		}
		c.Fields.Add(&core.SelectField{
			Name:      "status",
			Values:    []string{"new", "contacted", "closed"},
			MaxSelect: 1,
		})
		return app.Save(c)
	}, func(app core.App) error {
		c, err := app.FindCollectionByNameOrId("leads")
		if err != nil {
			return err
		}
		c.Fields.RemoveByName("status")
		return app.Save(c)
	})
}
