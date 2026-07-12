package migrations

import (
	"github.com/pocketbase/pocketbase/core"
	m "github.com/pocketbase/pocketbase/migrations"
)

// Adds the opt-in toggle for controller-back-online notifications. It pairs with
// alert_device_offline: users who want offline alerts usually also want the
// recovery message, but it defaults off to avoid noise on flaky links.
func init() {
	m.Register(func(app core.App) error {
		c, err := app.FindCollectionByNameOrId("notification_prefs")
		if err != nil {
			return err
		}
		if c.Fields.GetByName("alert_device_online") == nil {
			c.Fields.Add(&core.BoolField{Name: "alert_device_online"})
		}
		return app.Save(c)
	}, func(app core.App) error {
		c, err := app.FindCollectionByNameOrId("notification_prefs")
		if err != nil {
			return err
		}
		c.Fields.RemoveByName("alert_device_online")
		return app.Save(c)
	})
}
