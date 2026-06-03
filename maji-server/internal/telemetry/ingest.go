// Package telemetry handles local-first ingestion, rollup, and retention of
// device telemetry. The backend stores opaque numeric samples; it never parses
// domain topology.
package telemetry

import (
	"strings"
	"time"

	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/core"
)

// Reading is a single parsed telemetry sample.
type Reading struct {
	Site   string
	Ctrl   string // device_id
	Sensor string
	Value  float64
	TS     time.Time
}

// ParseTopic extracts site/ctrl/sensor from
// `majiflow/{site}/{ctrl}/telemetry/{sensor}`.
func ParseTopic(topic string) (site, ctrl, sensor string, ok bool) {
	parts := strings.Split(topic, "/")
	if len(parts) != 5 || parts[0] != "majiflow" || parts[3] != "telemetry" {
		return "", "", "", false
	}
	if parts[1] == "" || parts[2] == "" || parts[4] == "" {
		return "", "", "", false
	}
	return parts[1], parts[2], parts[4], true
}

// Ingest writes a raw telemetry sample (local-first) and marks the publishing
// controller online.
func Ingest(app core.App, r Reading) error {
	coll, err := app.FindCollectionByNameOrId("telemetry_raw")
	if err != nil {
		return err
	}
	rec := core.NewRecord(coll)
	rec.Set("site", r.Site)
	rec.Set("controller", r.Ctrl)
	rec.Set("sensor", r.Sensor)
	rec.Set("value", r.Value)
	rec.Set("ts", r.TS.UTC().Format(time.RFC3339))
	if err := app.Save(rec); err != nil {
		return err
	}
	markOnline(app, r.Ctrl, r.TS)
	return nil
}

func markOnline(app core.App, deviceID string, ts time.Time) {
	rec, err := app.FindFirstRecordByFilter(
		"controllers", "device_id = {:d}", dbx.Params{"d": deviceID},
	)
	if err != nil || rec == nil {
		return
	}
	rec.Set("online", true)
	rec.Set("last_seen", ts.UTC().Format(time.RFC3339))
	_ = app.Save(rec)
}
