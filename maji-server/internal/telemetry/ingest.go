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

// ParseIdentityTopic extracts site/ctrl from `majiflow/{site}/{ctrl}/identity`.
func ParseIdentityTopic(topic string) (site, ctrl string, ok bool) {
	return parseFour(topic, "identity")
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

// AutomationsTopic is the retained automation-set topic for a controller.
// Mirrors automationsTopic() in src/lib/codegen-ids.ts — keep both in sync.
func AutomationsTopic(site, ctrl string) string {
	return "majiflow/" + site + "/" + ctrl + "/automations"
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

// BindOrCheckMac is the duplicate-firmware tripwire. A controller's identity (MQTT
// username + baked token) is fixed at build time, so two boards flashed with the
// same firmware are indistinguishable to the broker's connect-time auth. The chip
// MAC, published retained on connect, is the only physical distinguisher: we bind
// the controller to the FIRST MAC seen and flag any later board reporting a
// different one.
//
// Detection only — both boards hold the valid token, so we flag + log, never
// disconnect (kicking the "impostor" just feeds the connect/disconnect flap, and
// we can't tell which board is wrong). The binding is sticky: a matching MAC is a
// no-op, and a conflict clears only via an explicit admin rebind (first_mac reset),
// so a legitimate board swap is a deliberate action, not a silent re-bind.
// Best-effort like the other ingest helpers: a failure never drops the connection.
func BindOrCheckMac(app core.App, ctrl, mac string) error {
	mac = strings.TrimSpace(mac)
	if ctrl == "" || mac == "" {
		return nil
	}
	// device_id is the controllers primary key — direct PK lookup.
	rec, err := app.FindRecordById("controllers", ctrl)
	if err != nil || rec == nil {
		return nil
	}
	first := rec.GetString("first_mac")
	switch {
	case first == "":
		// First board to connect under this identity — bind it.
		rec.Set("first_mac", mac)
		rec.Set("mac_conflict", false)
		rec.Set("conflict_mac", "")
	case first == mac:
		return nil // same board (or already-bound, reconnecting) — nothing to do
	case rec.GetBool("mac_conflict") && rec.GetString("conflict_mac") == mac:
		return nil // already flagged for this same impostor — idempotent
	default:
		// A different board is claiming this identity. Flag it; leave both online.
		rec.Set("mac_conflict", true)
		rec.Set("conflict_mac", mac)
		app.Logger().Warn("controller MAC conflict: two boards share one identity",
			"controller", ctrl, "bound_mac", first, "conflict_mac", mac)
	}
	_ = app.Save(rec)
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
	// device_id is the controllers primary key, so this is a direct PK lookup.
	rec, err := app.FindRecordById("controllers", deviceID)
	if err != nil || rec == nil {
		return
	}
	wasOnline := rec.GetBool("online")
	rec.Set("online", online)
	rec.Set("last_seen", ts.UTC())
	// Billing clock: a managed site's hosting year starts at its first controller's
	// first live connect. Checked only on the offline→online edge (cheap, rare); the
	// stamp itself is one-shot.
	if online && !wasOnline {
		stampCommence(app, rec.GetString("site"), ts)
	}
	_ = app.Save(rec)
}

// stampCommence starts a managed site's yearly hosting clock once, at first
// connect. Local (on-prem) sites never bill and are skipped; an unset mode is
// treated as managed (the cloud default). Never reset on later connects.
func stampCommence(app core.App, siteID string, ts time.Time) {
	if siteID == "" {
		return
	}
	site, err := app.FindRecordById("sites", siteID)
	if err != nil || site == nil {
		return
	}
	if site.GetString("mode") == "local" || !site.GetDateTime("commence_date").IsZero() {
		return
	}
	site.Set("commence_date", ts.UTC())
	_ = app.Save(site)
}
