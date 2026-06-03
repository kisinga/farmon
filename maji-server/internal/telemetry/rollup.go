package telemetry

import (
	"fmt"
	"time"

	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/core"
)

const (
	windowFiveMin int64 = 300
	windowHour    int64 = 3600
)

type aggRow struct {
	Site       string  `db:"site"`
	Controller string  `db:"controller"`
	Sensor     string  `db:"sensor"`
	Win        int64   `db:"win"`
	Avg        float64 `db:"avg"`
	Min        float64 `db:"min"`
	Max        float64 `db:"max"`
	N          int     `db:"n"`
}

// Rollup aggregates raw samples into 5-minute buckets, then 5-minute buckets
// into 1-hour buckets. It is idempotent: completed windows are upserted by key,
// so re-running over the same source data rewrites identical values and rolled
// aggregates survive pruning of their source rows.
func Rollup(app core.App, now time.Time) error {
	if err := rollup(app, "telemetry_raw", "telemetry_5min", "ts", windowFiveMin, now, false); err != nil {
		return err
	}
	return rollup(app, "telemetry_5min", "telemetry_1hr", "window", windowHour, now, true)
}

func rollup(app core.App, srcTable, dstTable, timeCol string, windowSec int64, now time.Time, weighted bool) error {
	cutoff := (now.UTC().Unix() / windowSec) * windowSec

	value := "AVG(value) AS avg, MIN(value) AS min, MAX(value) AS max, COUNT(*) AS n"
	if weighted {
		// Aggregating already-bucketed rows: weight averages by sample count.
		value = "SUM(avg*count)/SUM(count) AS avg, MIN(min) AS min, MAX(max) AS max, SUM(count) AS n"
	}

	sql := fmt.Sprintf(
		`SELECT site, controller, sensor,
			(CAST(strftime('%%s', %[1]s) AS INTEGER)/%[2]d)*%[2]d AS win,
			%[3]s
		 FROM %[4]s
		 GROUP BY site, controller, sensor, win
		 HAVING win < {:cutoff}`,
		timeCol, windowSec, value, srcTable,
	)

	var rows []aggRow
	if err := app.DB().NewQuery(sql).Bind(dbx.Params{"cutoff": cutoff}).All(&rows); err != nil {
		return err
	}

	coll, err := app.FindCollectionByNameOrId(dstTable)
	if err != nil {
		return err
	}

	for _, a := range rows {
		winTS := time.Unix(a.Win, 0).UTC().Format(time.RFC3339)
		rec, _ := app.FindFirstRecordByFilter(
			dstTable,
			"site={:s} && controller={:c} && sensor={:n} && window={:w}",
			dbx.Params{"s": a.Site, "c": a.Controller, "n": a.Sensor, "w": winTS},
		)
		if rec == nil {
			rec = core.NewRecord(coll)
			rec.Set("site", a.Site)
			rec.Set("controller", a.Controller)
			rec.Set("sensor", a.Sensor)
			rec.Set("window", winTS)
		}
		rec.Set("avg", a.Avg)
		rec.Set("min", a.Min)
		rec.Set("max", a.Max)
		rec.Set("count", a.N)
		if err := app.Save(rec); err != nil {
			return err
		}
	}
	return nil
}
