package migrations

import (
	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/core"
	m "github.com/pocketbase/pocketbase/migrations"
)

// Drop automation_set. The baked-schedule pause/resume command is retired —
// automations are first-class runtime data (the `automations` collection +
// retained set), not a per-schedule enable toggle. Removes the action enum value
// and the automation_id field, and discards historical automation_set rows.
//
// A new migration (not an edit of 19/22) so PB actually runs it: applied migrations
// are tracked by filename and never re-execute.

var commandActionsV25 = append(append([]string{}, commandActionsV10...), "config_set")

func init() {
	m.Register(func(app core.App) error {
		// Discard historical automation_set commands (no backward compat).
		_, err := app.DB().NewQuery("DELETE FROM commands WHERE action = {:a}").
			Bind(dbx.Params{"a": "automation_set"}).Execute()
		if err != nil {
			return err
		}
		if err := setCommandActionValues(app, commandActionsV25); err != nil {
			return err
		}
		c, err := app.FindCollectionByNameOrId("commands")
		if err != nil {
			return err
		}
		c.Fields.RemoveByName("automation_id")
		return app.Save(c)
	}, func(app core.App) error {
		// Down: restore the enum value + field (rows are not recoverable).
		if err := setCommandActionValues(app, commandActionsV22); err != nil {
			return err
		}
		c, err := app.FindCollectionByNameOrId("commands")
		if err != nil {
			return err
		}
		c.Fields.Add(&core.TextField{Name: "automation_id", Max: 100})
		return app.Save(c)
	})
}
