package telemetry

import (
	"time"

	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/core"
)

// Retention windows. The aggregate tables are hard-capped at ~30 days; raw
// samples are kept only long enough to guarantee every window is rolled up
// before its source rows are pruned. The transition log and command audit are
// time-bounded too (the never-pruned shadow always holds current state, so
// trimming history never blanks the dashboard); the command audit is kept
// longer for compliance.
const (
	RawRetention     = 48 * time.Hour
	AggRetention     = 30 * 24 * time.Hour
	EventRetention   = 180 * 24 * time.Hour
	CommandRetention = 365 * 24 * time.Hour
)

// pbDateLayout matches PocketBase's stored autodate format (vs RFC3339 for our
// own text timestamp columns), so a lexical `<` comparison prunes correctly.
const pbDateLayout = "2006-01-02 15:04:05.000Z"

// Prune deletes telemetry/events/commands older than the retention windows.
func Prune(app core.App, now time.Time) error {
	rawCut := now.UTC().Add(-RawRetention).Format(time.RFC3339)
	aggCut := now.UTC().Add(-AggRetention).Format(time.RFC3339)
	eventCut := now.UTC().Add(-EventRetention).Format(time.RFC3339)
	commandCut := now.UTC().Add(-CommandRetention).Format(pbDateLayout)

	deletes := []struct {
		table, col, cut string
	}{
		{"telemetry_raw", "ts", rawCut},
		{"telemetry_5min", "window", aggCut},
		{"telemetry_1hr", "window", aggCut},
		{"state_events", "ts", eventCut},
		{"config_events", "ts", eventCut},
		{"commands", "created", commandCut},
	}

	for _, d := range deletes {
		_, err := app.DB().
			NewQuery("DELETE FROM " + d.table + " WHERE " + d.col + " < {:cut}").
			Bind(dbx.Params{"cut": d.cut}).
			Execute()
		if err != nil {
			return err
		}
	}
	return nil
}
