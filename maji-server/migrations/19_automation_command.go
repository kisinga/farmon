package migrations

import (
	"github.com/pocketbase/pocketbase/core"
	m "github.com/pocketbase/pocketbase/migrations"
)

// commands.action gains automation_set, and commands gains an automation_id
// field, so the dashboard's runtime schedule pause/resume passes the SelectField
// validation and records which schedule it targeted (route_id is null for these).
// Mirrors the CommandAction union in src/lib/codegen-ids.ts. Without the enum
// value the record Save is rejected and the command endpoint returns 500.

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
