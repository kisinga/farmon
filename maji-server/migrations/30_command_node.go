package migrations

import (
	"github.com/pocketbase/pocketbase/core"
	m "github.com/pocketbase/pocketbase/migrations"
)

// commands gains node_id / node_on so a node_set command (manual valve/pump
// claim) records which actuator it targeted and whether it was opened or closed.
// Without these the audit row says only "node_set" with no target, so the
// dashboard's command history can't say "Opened Valve 1". node_on is only read
// for node_set rows; its default-false is irrelevant to other actions.
func init() {
	m.Register(func(app core.App) error {
		c, err := app.FindCollectionByNameOrId("commands")
		if err != nil {
			return err
		}
		c.Fields.Add(
			&core.TextField{Name: "node_id", Max: 64},
			&core.BoolField{Name: "node_on"},
		)
		return app.Save(c)
	}, func(app core.App) error {
		c, err := app.FindCollectionByNameOrId("commands")
		if err != nil {
			return err
		}
		c.Fields.RemoveByName("node_id")
		c.Fields.RemoveByName("node_on")
		return app.Save(c)
	})
}
