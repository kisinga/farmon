package migrations

import (
	"github.com/pocketbase/pocketbase/core"
	m "github.com/pocketbase/pocketbase/migrations"
)

// commands.action gains node_set + safety_override so the dashboard's manual
// control (claim/release an actuator, toggle the commissioning safety override)
// passes the SelectField validation when recorded for audit. Without this the
// record Save is rejected and the command endpoint returns 500. Mirrors the
// CommandAction union in src/lib/codegen-ids.ts.

var commandActionsV10 = []string{
	"route_start", "route_stop", "fault_reset", "stop_all", "reset_faults", "clear_queue",
	"node_set", "safety_override",
}

var commandActionsV5 = []string{
	"route_start", "route_stop", "fault_reset", "stop_all", "reset_faults", "clear_queue",
}

func setCommandActionValues(app core.App, values []string) error {
	c, err := app.FindCollectionByNameOrId("commands")
	if err != nil {
		return err
	}
	f, ok := c.Fields.GetByName("action").(*core.SelectField)
	if !ok {
		return nil // field shape changed elsewhere; nothing to do
	}
	f.Values = values
	return app.Save(c)
}

func init() {
	m.Register(func(app core.App) error {
		return setCommandActionValues(app, commandActionsV10)
	}, func(app core.App) error {
		return setCommandActionValues(app, commandActionsV5)
	})
}
