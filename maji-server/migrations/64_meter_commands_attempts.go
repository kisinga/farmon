package migrations

import (
	"github.com/pocketbase/pocketbase/core"
	m "github.com/pocketbase/pocketbase/migrations"
)

// meter_commands hardening (metering package defect fixes):
//   - attempts: how many times the command has actually been sent; the
//     listener caps ack-timeout retries at billing_settings.cmd_max_attempts
//     (per-site; default 3).
//   - ack_raw: hex of the raw ack payload, kept for live-device validation
//     of the valve-command echo.
//   - idx_meter_commands_pending_valve: partial unique index so a second
//     pending valve command for the same meter fails at the DB layer, not
//     just at the HasPendingValve pre-check (TOCTOU guard). Partial indexes
//     can't be expressed via AddIndex, hence raw SQL.
func init() {
	m.Register(func(app core.App) error {
		commands, err := app.FindCollectionByNameOrId("meter_commands")
		if err != nil {
			return err
		}
		commands.Fields.Add(
			&core.NumberField{Name: "attempts", OnlyInt: true},
			&core.TextField{Name: "ack_raw", Max: 10_000},
		)
		if err := app.Save(commands); err != nil {
			return err
		}
		_, err = app.DB().NewQuery(
			"CREATE UNIQUE INDEX IF NOT EXISTS idx_meter_commands_pending_valve " +
				"ON meter_commands(meter) " +
				"WHERE status IN ('queued','sent') AND type IN ('valve_open','valve_close')",
		).Execute()
		return err
	}, func(app core.App) error {
		if _, err := app.DB().NewQuery(
			"DROP INDEX IF EXISTS idx_meter_commands_pending_valve",
		).Execute(); err != nil {
			return err
		}
		commands, err := app.FindCollectionByNameOrId("meter_commands")
		if err != nil {
			return nil // already gone
		}
		for _, name := range []string{"attempts", "ack_raw"} {
			commands.Fields.RemoveByName(name)
		}
		return app.Save(commands)
	})
}
