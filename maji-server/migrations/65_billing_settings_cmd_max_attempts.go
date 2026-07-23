package migrations

import (
	"github.com/pocketbase/pocketbase/core"
	m "github.com/pocketbase/pocketbase/migrations"
)

// billing_settings.cmd_max_attempts: per-site cap on meter-command send
// attempts before the command is marked failed and the owners are alerted.
// This used to be the MAJI_METER_CMD_MAX_ATTEMPTS env var; it is operational
// policy (like grace_days/warn_days), so it lives in the DB where it takes
// effect immediately and can differ per site. 0/empty = default (3).
func init() {
	m.Register(func(app core.App) error {
		settings, err := app.FindCollectionByNameOrId("billing_settings")
		if err != nil {
			return err
		}
		settings.Fields.Add(&core.NumberField{Name: "cmd_max_attempts", OnlyInt: true})
		return app.Save(settings)
	}, func(app core.App) error {
		settings, err := app.FindCollectionByNameOrId("billing_settings")
		if err != nil {
			return nil // already gone
		}
		settings.Fields.RemoveByName("cmd_max_attempts")
		return app.Save(settings)
	})
}
