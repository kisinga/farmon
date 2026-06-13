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

// ParseStatusTopic extracts site/ctrl from `majiflow/{site}/{ctrl}/status`.
func ParseStatusTopic(topic string) (site, ctrl string, ok bool) {
	return parseFour(topic, "status")
}

// ParseIdentityTopic extracts site/ctrl from `majiflow/{site}/{ctrl}/identity`.
func ParseIdentityTopic(topic string) (site, ctrl string, ok bool) {
	return parseFour(topic, "identity")
}

// ParseSnapshotTopic extracts site/ctrl from `majiflow/{site}/{ctrl}/state`.
func ParseSnapshotTopic(topic string) (site, ctrl string, ok bool) {
	return parseFour(topic, "state")
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

// SetOnline records a controller's online/offline status (retained birth/will).
func SetOnline(app core.App, deviceID string, online bool, ts time.Time) error {
	setControllerOnline(app, deviceID, online, ts)
	return nil
}

// SetOffline flips a controller's presence flag to false when the broker observes
// its connection drop. It exists because the device's Last-Will never reaches the
// ingest path: Mochi publishes a will via publishToSubscribers (bypassing the
// OnPublish hook), so the status-topic "0" is never seen server-side and the flag
// would otherwise be write-once-true. The drop is signalled by the broker's
// OnDisconnect instead.
//
// last_seen is intentionally left untouched — it records the last message heard,
// not the moment of the drop, so the dashboard's "last seen Xm ago" stays honest.
// Idempotent (no write when already offline) and best-effort.
func SetOffline(app core.App, deviceID string) error {
	if deviceID == "" {
		return nil
	}
	// device_id is the controllers primary key — direct PK lookup.
	rec, err := app.FindRecordById("controllers", deviceID)
	if err != nil || rec == nil {
		return err
	}
	if !rec.GetBool("online") {
		return nil
	}
	rec.Set("online", false)
	return app.Save(rec)
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

// --- Controller snapshot (the single source of truth) -----------------------

type snapRoute struct {
	ID     int    `json:"id"`
	State  string `json:"state"`
	Origin string `json:"origin"`
	Actor  string `json:"actor"`
	Reason string `json:"reason"`
	// ActorLabel is filled server-side (the resolved display name) and stored in
	// the controller_state doc so the dashboard shows "by Jane" / "Automation: …".
	ActorLabel string `json:"actorLabel,omitempty"`
}

type snapOutcome struct {
	CommandID string `json:"command_id"`
	Result    string `json:"result"`
	Reason    string `json:"reason"`
}

type controllerSnapshot struct {
	TS       int64              `json:"ts"`
	Readings map[string]float64 `json:"readings"`
	Text     map[string]string  `json:"text"`
	System   struct {
		State  string  `json:"state"`
		Queue  float64 `json:"queue"`
		Safety bool    `json:"safety"`
	} `json:"system"`
	Routes   []snapRoute   `json:"routes"`
	Outcomes []snapOutcome `json:"outcomes"`
}

// IngestSnapshot projects one controller snapshot — the single source of truth —
// into the existing stores: numeric readings → telemetry_raw (rollups) + shadow,
// text/system → shadow, each route's current run → shadow (with the resolved
// origin label) plus a derived state_events row on any change, and command
// outcomes → the matching commands record. One server-stamped ts for the whole
// sample set, so the rollup buckets cleanly. Malformed payloads are ignored.
func IngestSnapshot(app core.App, site, ctrl string, payload []byte, now time.Time) error {
	var s controllerSnapshot
	if err := json.Unmarshal(payload, &s); err != nil {
		return nil
	}
	tsStr := now.UTC().Format(time.RFC3339)

	// Load the prior doc once: its routes are the "from" states for the timeline.
	doc, _ := app.FindFirstRecordByFilter("controller_state",
		"controller = {:c}", dbx.Params{"c": ctrl})
	prevState := map[int]string{}
	if doc != nil {
		var prev controllerSnapshot
		if json.Unmarshal([]byte(doc.GetString("snapshot")), &prev) == nil {
			for _, r := range prev.Routes {
				prevState[r.ID] = r.State
			}
		}
	}

	// Numeric readings → raw history (rollups), one ts across the whole set.
	if raw, err := app.FindCollectionByNameOrId("telemetry_raw"); err == nil {
		for sensor, v := range s.Readings {
			rec := core.NewRecord(raw)
			rec.Set("site", site)
			rec.Set("controller", ctrl)
			rec.Set("sensor", sensor)
			rec.Set("value", v)
			rec.Set("ts", tsStr)
			_ = app.Save(rec)
		}
	}

	// Resolve each route's origin actor to a display name (stored in the doc) and
	// derive a state_events row on any state change.
	for i := range s.Routes {
		r := &s.Routes[i]
		r.ActorLabel = resolveActorLabel(app, r.Origin, r.Actor)
		if p, ok := prevState[r.ID]; ok && p != "" && p != r.State {
			appendDerivedEvent(app, site, ctrl, r.ID, p, r.State, r.Reason, tsStr)
		}
	}

	// Upsert the single latest-snapshot doc (the per-sensor shadow, collapsed).
	if coll, err := app.FindCollectionByNameOrId("controller_state"); err == nil {
		if doc == nil {
			doc = core.NewRecord(coll)
			doc.Set("site", site)
			doc.Set("controller", ctrl)
		}
		if blob, err := json.Marshal(s); err == nil {
			doc.Set("snapshot", string(blob))
		}
		doc.Set("ts", tsStr)
		_ = app.Save(doc)
	}

	// Command outcomes → reconcile the commands record (idempotent).
	for _, o := range s.Outcomes {
		reconcileCommand(app, o.CommandID, o.Result, o.Reason)
	}
	// Running firmware version (from the device's metadata sensor) → confirm an OTA
	// release once the device reports the version it was told to flash. Version match
	// after reboot is the reliable success signal (the pre-reboot command ack can be
	// lost when the flash reboots the device before the next snapshot publishes).
	if fw := s.Text["fw_version"]; fw != "" {
		reconcileFirmware(app, ctrl, fw)
	}
	setControllerOnline(app, ctrl, true, now)
	return nil
}

// reconcileFirmware records the controller's running firmware version and flips any
// release it was deploying to "confirmed" once the device reports that version.
// Idempotent — a repeated snapshot with an unchanged version is a no-op.
func reconcileFirmware(app core.App, ctrl, version string) {
	if c, err := app.FindRecordById("controllers", ctrl); err == nil && c != nil {
		if c.GetString("firmware_version") != version {
			c.Set("firmware_version", version)
			_ = app.Save(c)
		}
	}
	rec, _ := app.FindFirstRecordByFilter("firmware_releases",
		"controller = {:c} && version = {:v} && status = 'deployed'",
		dbx.Params{"c": ctrl, "v": version})
	if rec == nil {
		return
	}
	rec.Set("status", "confirmed")
	_ = app.Save(rec)
}

// resolveActorLabel turns a route's origin+actor (whole ids) into a display label:
// MANUAL → the user's name/email; AUTOMATION → the automation's name; else "".
func resolveActorLabel(app core.App, origin, actor string) string {
	if actor == "" {
		return ""
	}
	switch origin {
	case "MANUAL":
		if u, err := app.FindRecordById("users", actor); err == nil && u != nil {
			if n := u.GetString("name"); n != "" {
				return n
			}
			return u.GetString("email")
		}
	case "AUTOMATION":
		if a, err := app.FindRecordById("automations", actor); err == nil && a != nil {
			if n := a.GetString("name"); n != "" {
				return n
			}
			return "Automation"
		}
	}
	return ""
}

func appendDerivedEvent(app core.App, site, ctrl string, route int, from, to, reason, tsStr string) {
	coll, err := app.FindCollectionByNameOrId("state_events")
	if err != nil {
		return
	}
	rec := core.NewRecord(coll)
	rec.Set("site", site)
	rec.Set("controller", ctrl)
	rec.Set("route", route)
	rec.Set("from_state", from)
	rec.Set("to_state", to)
	rec.Set("reason", reason)
	rec.Set("ts", tsStr)
	_ = app.Save(rec)
}

// reconcileCommand moves a command's audit row to its terminal state from the
// device's re-asserted outcome. Idempotent — a repeated outcome is a no-op.
func reconcileCommand(app core.App, commandID, result, reason string) {
	if commandID == "" {
		return
	}
	rec, _ := app.FindFirstRecordByFilter("commands", "command_id = {:c}", dbx.Params{"c": commandID})
	if rec == nil {
		return
	}
	status := "done"
	if result == "REFUSED" || result == "REJECTED" {
		status = "failed"
	}
	if rec.GetString("status") == status && rec.GetString("result") == reason {
		return
	}
	rec.Set("status", status)
	rec.Set("result", reason)
	_ = app.Save(rec)
}
