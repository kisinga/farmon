package migrations

import (
	"github.com/pocketbase/pocketbase/core"
	m "github.com/pocketbase/pocketbase/migrations"
)

// Automations previously stored time_min as "minutes since local midnight". The
// device compares it against SNTP UTC, so schedules fired at the wrong local time.
// This migration converts existing values to "minutes since UTC midnight" using
// the launch-market default (EAT = UTC+3, offset +180 minutes), and rotates the
// weekday mask when the conversion crosses midnight so the local day-of-week is
// preserved.
//
// Example: 06:00 EAT (360 local) → 03:00 UTC (180 UTC).
// Example crossing midnight: 01:00 EAT (60 local) → 22:00 UTC previous day (1320 UTC).
func init() {
	m.Register(func(app core.App) error {
		rows, err := app.FindAllRecords("automations")
		if err != nil {
			return err
		}
		const offsetMin = 180 // EAT = UTC+3
		const dayMin = 1440
		for _, rec := range rows {
			if rec.GetString("trigger_type") != "time" {
				continue
			}
			localMin := rec.GetInt("time_min")
			utcMin := ((localMin-offsetMin)%dayMin + dayMin) % dayMin
			mask := rec.GetInt("days_mask")
			if localMin < offsetMin {
				// Local early morning maps to the previous UTC day: shift mask back.
				mask = ((mask >> 1) | ((mask & 1) << 6)) & 0x7F
			}
			rec.Set("time_min", utcMin)
			rec.Set("days_mask", mask)
			if err := app.Save(rec); err != nil {
				return err
			}
		}
		return nil
	}, func(app core.App) error {
		// Downgrade: convert back to local (EAT) minutes and reverse the day shift.
		rows, err := app.FindAllRecords("automations")
		if err != nil {
			return err
		}
		const offsetMin = 180
		const dayMin = 1440
		for _, rec := range rows {
			if rec.GetString("trigger_type") != "time" {
				continue
			}
			utcMin := rec.GetInt("time_min")
			localMin := ((utcMin+offsetMin)%dayMin + dayMin) % dayMin
			mask := rec.GetInt("days_mask")
			if utcMin+offsetMin >= dayMin {
				// UTC late evening maps to the next local day: shift mask forward.
				mask = ((mask << 1) | (mask >> 6)) & 0x7F
			}
			rec.Set("time_min", localMin)
			rec.Set("days_mask", mask)
			if err := app.Save(rec); err != nil {
				return err
			}
		}
		return nil
	})
}
