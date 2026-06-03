package telemetry

import (
	"time"

	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/core"
)

// Retention windows. The aggregate tables are hard-capped at ~30 days; raw
// samples are kept only long enough to guarantee every window is rolled up
// before its source rows are pruned.
const (
	RawRetention = 48 * time.Hour
	AggRetention = 30 * 24 * time.Hour
)

// Prune deletes telemetry older than the retention windows.
func Prune(app core.App, now time.Time) error {
	rawCut := now.UTC().Add(-RawRetention).Format(time.RFC3339)
	aggCut := now.UTC().Add(-AggRetention).Format(time.RFC3339)

	deletes := []struct {
		table, col, cut string
	}{
		{"telemetry_raw", "ts", rawCut},
		{"telemetry_5min", "window", aggCut},
		{"telemetry_1hr", "window", aggCut},
	}

	for _, d := range deletes {
		_, err := app.DB().
			NewQuery("DELETE FROM "+d.table+" WHERE "+d.col+" < {:cut}").
			Bind(dbx.Params{"cut": d.cut}).
			Execute()
		if err != nil {
			return err
		}
	}
	return nil
}
