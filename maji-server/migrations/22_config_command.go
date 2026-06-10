package migrations

import (
	"github.com/pocketbase/pocketbase/core"
	m "github.com/pocketbase/pocketbase/migrations"
)

// commands.action gains config_set, and commands gains config_key / config_value
// fields, so the dashboard's runtime setpoint edit (a route's source-min /
// dest-max tank %) passes the SelectField validation and records which number it
// set and to what. Mirrors the CommandAction union in src/lib/codegen-ids.ts.
// Without the enum value the record Save is rejected and the command endpoint
// returns 500.

var commandActionsV22 = append(append([]string{}, commandActionsV19...), "config_set")

func init() {
	m.Register(func(app core.App) error {
		if err := setCommandActionValues(app, commandActionsV22); err != nil {
			return err
		}
		c, err := app.FindCollectionByNameOrId("commands")
		if err != nil {
			return err
		}
		c.Fields.Add(
			&core.TextField{Name: "config_key", Max: 64},
			&core.NumberField{Name: "config_value"},
		)
		return app.Save(c)
	}, func(app core.App) error {
		if err := setCommandActionValues(app, commandActionsV19); err != nil {
			return err
		}
		c, err := app.FindCollectionByNameOrId("commands")
		if err != nil {
			return err
		}
		c.Fields.RemoveByName("config_key")
		c.Fields.RemoveByName("config_value")
		return app.Save(c)
	})
}
