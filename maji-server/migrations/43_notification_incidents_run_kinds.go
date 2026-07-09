package migrations

import (
	"github.com/pocketbase/pocketbase/core"
	m "github.com/pocketbase/pocketbase/migrations"
)

// Extend notification_incidents.kind with route-run transition kinds.
func init() {
	m.Register(func(app core.App) error {
		c, err := app.FindCollectionByNameOrId("notification_incidents")
		if err != nil {
			return err
		}
		sf, ok := c.Fields.GetByName("kind").(*core.SelectField)
		if !ok {
			return nil
		}
		have := map[string]bool{}
		for _, v := range sf.Values {
			have[v] = true
		}
		for _, v := range []string{"run_start", "run_stop"} {
			if !have[v] {
				sf.Values = append(sf.Values, v)
			}
		}
		return app.Save(c)
	}, func(app core.App) error {
		c, err := app.FindCollectionByNameOrId("notification_incidents")
		if err != nil {
			return err
		}
		sf, ok := c.Fields.GetByName("kind").(*core.SelectField)
		if !ok {
			return nil
		}
		filtered := sf.Values[:0]
		for _, v := range sf.Values {
			if v != "run_start" && v != "run_stop" {
				filtered = append(filtered, v)
			}
		}
		sf.Values = filtered
		return app.Save(c)
	})
}
