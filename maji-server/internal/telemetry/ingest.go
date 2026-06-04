// Package telemetry handles local-first ingestion, rollup, and retention of
// device telemetry. The backend stores opaque values; it never parses domain
// topology. Numbers ride as numbers (rolled up); categorical channels ride as
// short human-readable tokens (kept in the shadow only); transitions ride as
// StateEvent JSON (appended to the event log).
package telemetry

import (
	"encoding/json"
	"strings"
	"time"

	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/core"
)

// Reading is a single parsed numeric telemetry sample.
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

// ParseEventTopic extracts site/ctrl from `majiflow/{site}/{ctrl}/event`.
func ParseEventTopic(topic string) (site, ctrl string, ok bool) {
	return parseFour(topic, "event")
}

// ParseStatusTopic extracts site/ctrl from `majiflow/{site}/{ctrl}/status`.
func ParseStatusTopic(topic string) (site, ctrl string, ok bool) {
	return parseFour(topic, "status")
}

func parseFour(topic, last string) (site, ctrl string, ok bool) {
	parts := strings.Split(topic, "/")
	if len(parts) != 4 || parts[0] != "majiflow" || parts[3] != last {
		return "", "", false
	}
	if parts[1] == "" || parts[2] == "" {
		return "", "", false
	}
	return parts[1], parts[2], true
}

// CommandTopic is the operator-command topic for a controller. Mirrors
// commandTopic() in src/lib/codegen-ids.ts — keep both in sync.
func CommandTopic(site, ctrl string) string {
	return "majiflow/" + site + "/" + ctrl + "/command"
}

// Ingest writes a raw numeric sample (local-first), updates the shadow, and
// marks the publishing controller online.
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
	upsertShadowNumber(app, r.Site, r.Ctrl, r.Sensor, r.Value, r.TS)
	setControllerOnline(app, r.Ctrl, true, r.TS)
	return nil
}

// IngestString records a categorical channel value (a token like "RUNNING").
// It updates the shadow's text column only — tokens are never rolled up.
func IngestString(app core.App, site, ctrl, sensor, text string, ts time.Time) error {
	upsertShadowText(app, site, ctrl, sensor, text, ts)
	setControllerOnline(app, ctrl, true, ts)
	return nil
}

// stateEventPayload is the wire body on the event topic (see StateEvent in
// src/lib/codegen-ids.ts). `from`/`to` map to the from_state/to_state columns.
type stateEventPayload struct {
	Route     int    `json:"route"`
	From      string `json:"from"`
	To        string `json:"to"`
	Reason    string `json:"reason"`
	CommandID string `json:"command_id"`
}

// IngestEvent appends one transition to state_events and marks the controller
// online. Malformed payloads are ignored (never drop the connection).
func IngestEvent(app core.App, site, ctrl string, payload []byte, ts time.Time) error {
	var ev stateEventPayload
	if err := json.Unmarshal(payload, &ev); err != nil {
		return nil
	}
	coll, err := app.FindCollectionByNameOrId("state_events")
	if err != nil {
		return err
	}
	rec := core.NewRecord(coll)
	rec.Set("site", site)
	rec.Set("controller", ctrl)
	rec.Set("route", ev.Route)
	rec.Set("from_state", ev.From)
	rec.Set("to_state", ev.To)
	rec.Set("reason", ev.Reason)
	rec.Set("command_id", ev.CommandID)
	rec.Set("ts", ts.UTC().Format(time.RFC3339))
	if err := app.Save(rec); err != nil {
		return err
	}
	setControllerOnline(app, ctrl, true, ts)
	return nil
}

// SetOnline records a controller's online/offline status (retained birth/will).
func SetOnline(app core.App, deviceID string, online bool, ts time.Time) error {
	setControllerOnline(app, deviceID, online, ts)
	return nil
}

// findOrCreateShadow returns the never-pruned shadow row for a channel,
// creating it if absent. Returns nil only if the collection is missing.
func findOrCreateShadow(app core.App, site, ctrl, sensor string) *core.Record {
	rec, _ := app.FindFirstRecordByFilter(
		"entity_state",
		"site = {:s} && controller = {:c} && sensor = {:n}",
		dbx.Params{"s": site, "c": ctrl, "n": sensor},
	)
	if rec == nil {
		coll, err := app.FindCollectionByNameOrId("entity_state")
		if err != nil {
			return nil
		}
		rec = core.NewRecord(coll)
		rec.Set("site", site)
		rec.Set("controller", ctrl)
		rec.Set("sensor", sensor)
	}
	return rec
}

// upsertShadowNumber keeps the never-pruned last-known number current.
// Best-effort: a shadow failure must not drop the raw sample.
func upsertShadowNumber(app core.App, site, ctrl, sensor string, value float64, ts time.Time) {
	rec := findOrCreateShadow(app, site, ctrl, sensor)
	if rec == nil {
		return
	}
	rec.Set("reported", value)
	rec.Set("ts", ts.UTC().Format(time.RFC3339))
	_ = app.Save(rec)
}

// upsertShadowText keeps the never-pruned last-known token current.
func upsertShadowText(app core.App, site, ctrl, sensor, text string, ts time.Time) {
	rec := findOrCreateShadow(app, site, ctrl, sensor)
	if rec == nil {
		return
	}
	rec.Set("reported_text", text)
	rec.Set("ts", ts.UTC().Format(time.RFC3339))
	_ = app.Save(rec)
}

func setControllerOnline(app core.App, deviceID string, online bool, ts time.Time) {
	rec, err := app.FindFirstRecordByFilter(
		"controllers", "device_id = {:d}", dbx.Params{"d": deviceID},
	)
	if err != nil || rec == nil {
		return
	}
	rec.Set("online", online)
	rec.Set("last_seen", ts.UTC().Format(time.RFC3339))
	_ = app.Save(rec)
}
