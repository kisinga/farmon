package migrations

import (
	"github.com/pocketbase/pocketbase/core"
	m "github.com/pocketbase/pocketbase/migrations"
)

// Sites gain a `display_timezone`: the IANA timezone used only for browser display
// conversion (e.g. "Africa/Nairobi"). The device stays pure UTC; this field exists
// so the UI can render and edit times in the site's local wall-clock.
func init() {
	m.Register(func(app core.App) error {
		c, err := app.FindCollectionByNameOrId("sites")
		if err != nil {
			return err
		}
		c.Fields.Add(&core.TextField{Name: "display_timezone"})
		return app.Save(c)
	}, func(app core.App) error {
		c, err := app.FindCollectionByNameOrId("sites")
		if err != nil {
			return err
		}
		c.Fields.RemoveByName("display_timezone")
		return app.Save(c)
	})
}
