package migrations

import (
	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/core"
	m "github.com/pocketbase/pocketbase/migrations"
)

// Backfills alert_device_online for every subscriber who already opted into
// alert_device_offline. Migration 47 added the back-online toggle opt-in
// (default false) and never flipped it for existing rows, so anyone who had
// enabled offline alerts before (or since, without noticing the second
// toggle) has onlineTo empty in the alert sweep: notifyOnline resolves their
// offline incident silently and the recovery notification never goes out.
// Recovery is the other half of the offline subscription — a user told a
// controller died expects to be told it came back.
func BackfillDeviceOnline(app core.App) error {
	rows, err := app.FindRecordsByFilter("notification_prefs", "alert_device_offline = true", "", 0, 0, dbx.Params{})
	if err != nil {
		return err
	}
	for _, rec := range rows {
		if rec.GetBool("alert_device_online") {
			continue
		}
		rec.Set("alert_device_online", true)
		if err := app.Save(rec); err != nil {
			return err
		}
	}
	return nil
}

func init() {
	m.Register(func(app core.App) error {
		return BackfillDeviceOnline(app)
	}, func(app core.App) error {
		// No down: the backfill can't distinguish "enabled by this migration"
		// from "enabled deliberately", so reversing it would flip real choices.
		return nil
	})
}
