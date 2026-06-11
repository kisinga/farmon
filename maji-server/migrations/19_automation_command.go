package migrations

import (
	"github.com/pocketbase/pocketbase/core"
	m "github.com/pocketbase/pocketbase/migrations"
)

// commands.action gains automation_set, and commands gains an automation_id field.
// HISTORICAL: this shipped for the baked-schedule pause/resume command. That command
// is gone (automations are first-class runtime data now) — migration 24 drops the
// enum value + field again. Kept intact so PB's applied-migration history stays
// consistent on databases that already ran it.

var commandActionsV19 = append(append([]string{}, commandActionsV10...), "automation_set")

func init() {
	m.Register(func(app core.App) error {
		if err := setCommandActionValues(app, commandActionsV19); err != nil {
			return err
		}
		c, err := app.FindCollectionByNameOrId("commands")
		if err != nil {
			return err
		}
		c.Fields.Add(&core.TextField{Name: "automation_id", Max: 100})
		return app.Save(c)
	}, func(app core.App) error {
		if err := setCommandActionValues(app, commandActionsV10); err != nil {
			return err
		}
		c, err := app.FindCollectionByNameOrId("commands")
		if err != nil {
			return err
		}
		c.Fields.RemoveByName("automation_id")
		return app.Save(c)
	})
}
