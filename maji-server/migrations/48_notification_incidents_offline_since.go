package migrations

import (
	"github.com/pocketbase/pocketbase/core"
	m "github.com/pocketbase/pocketbase/migrations"
)

// Adds an offline_since timestamp to notification_incidents so the recovery
// notification can report the exact length of the outage (from the last seen
// time that triggered the offline alert to the moment the controller reconnects).
func init() {
	m.Register(func(app core.App) error {
		c, err := app.FindCollectionByNameOrId("notification_incidents")
		if err != nil {
			return err
		}
		if c.Fields.GetByName("offline_since") == nil {
			c.Fields.Add(&core.TextField{Name: "offline_since", Max: 40})
		}
		return app.Save(c)
	}, func(app core.App) error {
		c, err := app.FindCollectionByNameOrId("notification_incidents")
		if err != nil {
			return err
		}
		c.Fields.RemoveByName("offline_since")
		return app.Save(c)
	})
}
