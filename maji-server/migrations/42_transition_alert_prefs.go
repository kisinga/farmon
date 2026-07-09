package migrations

import (
	"github.com/pocketbase/pocketbase/core"
	m "github.com/pocketbase/pocketbase/migrations"
)

// Adds per-user toggles for route-run transition alerts (start / stop) alongside
// the existing fault/offline/tank types.
func init() {
	m.Register(func(app core.App) error {
		c, err := app.FindCollectionByNameOrId("notification_prefs")
		if err != nil {
			return err
		}
		if c.Fields.GetByName("alert_run_start") == nil {
			c.Fields.Add(&core.BoolField{Name: "alert_run_start"})
		}
		if c.Fields.GetByName("alert_run_stop") == nil {
			c.Fields.Add(&core.BoolField{Name: "alert_run_stop"})
		}
		return app.Save(c)
	}, func(app core.App) error {
		c, err := app.FindCollectionByNameOrId("notification_prefs")
		if err != nil {
			return err
		}
		c.Fields.RemoveByName("alert_run_start")
		c.Fields.RemoveByName("alert_run_stop")
		return app.Save(c)
	})
}
