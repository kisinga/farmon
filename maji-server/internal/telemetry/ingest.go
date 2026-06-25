// Package telemetry handles local-first ingestion, rollup, and retention of
// device telemetry. The backend stores opaque values; it never parses domain
// topology. Numbers ride as numbers (rolled up); categorical channels ride as
// short human-readable tokens (kept in the shadow only); transitions ride as
// StateEvent JSON (appended to the event log).
package telemetry

import (
	"encoding/json"
	"fmt"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/core"
)

// AckPublisher is the subset of the broker the run-ack uplink needs (the embedded
// Mochi server satisfies it). Nil for non-broker callers (tests, replay).
type AckPublisher interface {
	Publish(topic string, payload []byte, retain bool, qos byte) error
}

// AutomationsRepublisher re-pushes a controller's retained automation set to the
// device. Wired at startup (server.go) to automations.PublishForController — the
// indirection breaks an import cycle (the automations package imports this one for
// the topic helpers, so it can't be imported back). Nil for non-broker callers
// (tests, replay), in which case a firmware-change republish is simply skipped.
var AutomationsRepublisher func(app core.App, site, ctrl string) error

// ConfigRepublisher re-pushes a controller's retained desired-config message
// (tunables + calibration) to the device. Wired at startup (server.go) to
// automations.PublishConfigForController — same import-cycle-breaking indirection as
// AutomationsRepublisher. The reconcile loop calls it when the device's reported
// config_version drifts from the server-computed version (desired-vs-applied compare).
// Nil for non-broker callers (tests, replay), in which case reconcile is a no-op.
var ConfigRepublisher func(app core.App, site, ctrl string) error

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

// ConfigTopic is the retained desired-config topic for a controller — the single
// server-owned tunables+calibration message the device converges to. The payload's
// embedded `version` (server-computed sha256) is the opaque token the device echoes
// back as the snapshot text `config_version`. Mirrors configTopic() in
// src/lib/codegen-ids.ts — keep both in sync.
func ConfigTopic(site, ctrl string) string {
	return "majiflow/" + site + "/" + ctrl + "/config"
}

// RunsAckTopic is the retained run-ledger acknowledgement for a controller: a single
// high-water-mark (epoch, seq) the device uses to drop confirmed runs from its durable
// outbox. Mirrors runsAckTopic() in src/lib/codegen-ids.ts — keep both in sync.
func RunsAckTopic(site, ctrl string) string {
	return "majiflow/" + site + "/" + ctrl + "/runs_ack"
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
	// Live is the running run's progress facts (present only while RUNNING). It is
	// opaque to the server — carried through the shadow so the dashboard can render the
	// card-as-progress-bar. A pointer so it round-trips exactly (absent stays absent).
	Live *snapRunLive `json:"live,omitempty"`
}

// snapRunLive: facts for the live progress bar. The device reports them; the app
// computes the fraction + labels (so the UX is tunable without reflashing).
type snapRunLive struct {
	Del int `json:"del"` // delivered litres (-1 unmetered)
	Dur int `json:"dur"` // elapsed seconds
	Tv  int `json:"tv"`  // target volume L (0 none)
	Td  int `json:"td"`  // target duration s (0 none)
	Tl  int `json:"tl"`  // target level % (-1 none); the app reads the live dest level itself
}

type snapOutcome struct {
	CommandID string `json:"command_id"`
	Result    string `json:"result"`
	Reason    string `json:"reason"`
}

// snapRun is one immutable, closed run the device re-asserts in every snapshot
// (from its durable outbox) until the retained runs_ack high-water-mark reaches it.
// Both axes ride every record: duration_s is always present (monotonic run timer);
// the litre boundaries are meaningful only when metered. run_id is the device-minted
// composite (epoch+seq), the idempotency key.
type snapRun struct {
	RunID       string  `json:"run_id"`
	Route       int     `json:"route"`
	Epoch       int64   `json:"epoch"`
	Seq         int64   `json:"seq"`
	Origin      string  `json:"origin"`
	Actor       string  `json:"actor"`
	StartedAt   int64   `json:"started_at"` // device wall-clock unix secs (best-effort)
	EndedAt     int64   `json:"ended_at"`
	DurationS   int64   `json:"duration_s"`
	StopReason  string  `json:"stop_reason"`
	StartLitres float64 `json:"start_litres"`
	EndLitres   float64 `json:"end_litres"`
	Metered     bool    `json:"metered"`
	Fault       string  `json:"fault"`
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
	// Runs is the device's durable outbox of closed runs, re-asserted until acked.
	Runs []snapRun `json:"runs"`
}

// IngestSnapshot projects one controller snapshot — the single source of truth —
// into the existing stores: numeric readings → telemetry_raw (rollups) + shadow,
// text/system → shadow, each route's current run → shadow (with the resolved
// origin label) plus a derived state_events row on any change, and command
// outcomes → the matching commands record. One server-stamped ts for the whole
// sample set, so the rollup buckets cleanly. Malformed payloads are ignored.
func IngestSnapshot(app core.App, site, ctrl string, payload []byte, now time.Time, pub AckPublisher) error {
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
			appendDerivedEvent(app, site, ctrl, r.ID, p, r.State, r.Reason, tsStr, r.Origin, r.Actor, r.ActorLabel)
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
	// Closed runs → the immutable billing ledger (idempotent on controller+run_id).
	// The device re-asserts each run every snapshot until the retained runs_ack
	// high-water-mark passes it, so a dropped QoS-0 snapshot loses nothing. Persist
	// in (epoch, seq) order and STOP at the first failure: the device always sends a
	// contiguous run of unacked records, so stopping on a hole keeps the ledger
	// gap-free and the high-water-mark (MAX epoch,seq) from ever passing an
	// un-persisted run — which would otherwise drop a billable run.
	sort.Slice(s.Runs, func(a, b int) bool {
		if s.Runs[a].Epoch != s.Runs[b].Epoch {
			return s.Runs[a].Epoch < s.Runs[b].Epoch
		}
		return s.Runs[a].Seq < s.Runs[b].Seq
	})
	for i := range s.Runs {
		if err := persistRun(app, site, ctrl, &s.Runs[i]); err != nil {
			break
		}
	}
	// Acknowledge persisted runs: publish the retained high-water-mark so the device
	// drops every confirmed run from its outbox. Only when this snapshot carried runs
	// (a reconnecting device that re-asserts then gets re-acked), and only the
	// contiguous max (HighWaterRun, kept gap-free above) so a stalled batch never acks
	// past an un-persisted, billable run.
	if pub != nil && len(s.Runs) > 0 {
		if e, sq, ok := HighWaterRun(app, ctrl); ok {
			topic := RunsAckTopic(site, ctrl)
			payload := []byte(fmt.Sprintf("%d:%d", e, sq))
			// Publish off this goroutine: IngestSnapshot runs inside the broker's
			// OnPublish hook, and re-entering the broker to publish synchronously can
			// deadlock. The ack is retained, so a fire-and-forget send is fine.
			go func() { _ = pub.Publish(topic, payload, true, 1) }()
		}
	}
	// Running firmware version (from the device's metadata sensor) → confirm an OTA
	// release once the device reports the version it was told to flash. Version match
	// after reboot is the reliable success signal (the pre-reboot command ack can be
	// lost when the flash reboots the device before the next snapshot publishes).
	// This is now PURELY the deployed→confirmed flip: the reflash-republish special
	// case has been collapsed into reconcileConfig's desired-vs-applied compare below.
	if fw := s.Text["fw_version"]; fw != "" {
		reconcileFirmware(app, ctrl, fw)
	}

	// Desired-vs-applied reconcile (the generalized republish, replacing the old
	// fw-change special case). The device round-trips the opaque server-computed
	// config version as the snapshot text config_version; when it lags the version the
	// server last published (a reflash boots with an empty config + automation table,
	// or a desired-config edit raced the device), re-push the retained sets so the
	// device converges. Runs off this goroutine: IngestSnapshot executes synchronously
	// inside the broker's OnPublish hook, so re-entering the broker to publish here
	// would deadlock (same reason as the runs_ack uplink above). The sets are retained,
	// so a fire-and-forget send is fine.
	reconcileConfig(app, site, ctrl, s.Text["config_version"])

	setControllerOnline(app, ctrl, true, now)
	return nil
}

// reconcileFirmware records the controller's running firmware version and flips any
// release it was deploying to "confirmed" once the device reports that version.
// Idempotent — a repeated snapshot with an unchanged version is a no-op. The
// reflash-republish piggyback is gone (collapsed into reconcileConfig): this now only
// keeps the running version current and performs the deployed→confirmed release flip.
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

// configReconcileGate debounces the desired-vs-applied republish so a lagging device
// (whose config_version hasn't yet caught up because the apply round-trip is in
// flight) isn't re-pushed on every snapshot interval. Keyed by controller, it holds
// the server version we last republished toward plus when; we skip a re-push for the
// same target within the boot-debounce window, and clear once the device confirms.
var (
	configReconcileMu   sync.Mutex
	configReconcileSeen = map[string]configReconcileState{}
)

type configReconcileState struct {
	version string    // the server version we last republished toward
	at      time.Time // when we last republished (debounce anchor)
}

// configReconcileDebounce bounds how often a still-converging controller is
// re-pushed: long enough to cover the publish→apply→next-snapshot round trip, short
// enough that a genuinely-stuck device is retried.
const configReconcileDebounce = 30 * time.Second

// reconcileConfig compares the device-reported config version (the opaque token it
// round-trips from the retained /config message) against the version the server last
// computed for this controller's desired config, and re-pushes the retained config +
// automation sets when they differ. The persisted applied_version is updated to what
// the device reports (so the dashboard can show converged/pending). Republishes off
// the broker goroutine (never synchronously — see the caller) and debounces a device
// that is still applying, so an in-flight apply isn't re-pushed every interval.
func reconcileConfig(app core.App, site, ctrl, applied string) {
	rec, _ := app.FindFirstRecordByFilter("controller_config",
		"controller = {:c}", dbx.Params{"c": ctrl})
	// No desired config for this controller yet → nothing to converge to.
	if rec == nil {
		return
	}
	want := rec.GetString("version")

	// Record what the device reports as applied (idempotent), so the dashboard reflects
	// convergence without waiting for a republish.
	if rec.GetString("applied_version") != applied {
		rec.Set("applied_version", applied)
		_ = app.Save(rec)
	}

	// Converged: the device is on the server's current version. Clear any debounce
	// marker so a future drift re-pushes immediately.
	if applied == want {
		configReconcileMu.Lock()
		delete(configReconcileSeen, ctrl)
		configReconcileMu.Unlock()
		return
	}

	// Drift. Debounce: skip if we already re-pushed toward this same version recently
	// (the apply is likely still in flight). A new target version, a stuck device past
	// the window, or a first sighting falls through to republish.
	now := time.Now()
	configReconcileMu.Lock()
	st, ok := configReconcileSeen[ctrl]
	if ok && st.version == want && now.Sub(st.at) < configReconcileDebounce {
		configReconcileMu.Unlock()
		return
	}
	configReconcileSeen[ctrl] = configReconcileState{version: want, at: now}
	configReconcileMu.Unlock()

	// Re-push both retained sets: a reflash empties the in-RAM automation table along
	// with the config, so converging config also re-asserts automations. Off-goroutine
	// (caller runs inside the broker OnPublish hook); the sets are retained.
	if ConfigRepublisher != nil {
		go func() { _ = ConfigRepublisher(app, site, ctrl) }()
	}
	if AutomationsRepublisher != nil {
		go func() { _ = AutomationsRepublisher(app, site, ctrl) }()
	}
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

// appendDerivedEvent records one route transition with the attribution the device
// bound to that run (origin/actor) plus the server-resolved actor_label, so the
// timeline can say who/what caused it — the same "who" the commands ledger gives
// node actions. The device keeps origin/actor bound to the route's state until the
// next transition rebinds it (per-transition attribution: a manual stop of an
// automation run reports the stopper), so the terminal IDLE event is attributed too.
func appendDerivedEvent(app core.App, site, ctrl string, route int, from, to, reason, tsStr, origin, actor, actorLabel string) {
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
	rec.Set("origin", origin)
	rec.Set("actor", actor)
	rec.Set("actor_label", actorLabel)
	_ = app.Save(rec)
}

// persistRun appends one closed run to the billing ledger. Idempotent on
// (controller, run_id): the device re-asserts a run in every snapshot until the
// runs_ack high-water-mark confirms it, so a duplicate is a no-op (runs are
// immutable — never updated). The litre boundaries are meaningful only when metered;
// an unmetered run is time-billable, so it still lands with metered=false.
func persistRun(app core.App, site, ctrl string, r *snapRun) error {
	if r.RunID == "" {
		return nil
	}
	if existing, _ := app.FindFirstRecordByFilter("runs",
		"controller = {:c} && run_id = {:r}", dbx.Params{"c": ctrl, "r": r.RunID}); existing != nil {
		return nil // already persisted (a re-asserted run) — a no-op success, not a gap
	}
	coll, err := app.FindCollectionByNameOrId("runs")
	if err != nil {
		return err
	}
	rec := core.NewRecord(coll)
	rec.Set("site", site)
	rec.Set("controller", ctrl)
	rec.Set("route", r.Route)
	rec.Set("run_id", r.RunID)
	rec.Set("epoch", r.Epoch)
	rec.Set("seq", r.Seq)
	rec.Set("origin", r.Origin)
	rec.Set("actor", r.Actor)
	rec.Set("actor_label", resolveActorLabel(app, r.Origin, r.Actor))
	rec.Set("started_at", unixToISO(r.StartedAt))
	rec.Set("ended_at", unixToISO(r.EndedAt))
	rec.Set("duration_s", r.DurationS)
	rec.Set("stop_reason", r.StopReason)
	rec.Set("start_litres", r.StartLitres)
	rec.Set("end_litres", r.EndLitres)
	rec.Set("metered", r.Metered)
	rec.Set("fault", r.Fault)
	if err := app.Save(rec); err != nil {
		// A concurrent re-assert may have inserted this run between our existence check
		// and the save (the unique index rejects the dup). That is success, not a gap —
		// don't break the batch on it.
		if dup, _ := app.FindFirstRecordByFilter("runs",
			"controller = {:c} && run_id = {:r}", dbx.Params{"c": ctrl, "r": r.RunID}); dup != nil {
			return nil
		}
		// A real failure: the high-water-mark won't advance past this run, so the device
		// keeps re-asserting it. Returning the error stops the caller from persisting
		// later (higher-seq) runs this pass, keeping the ledger gap-free.
		app.Logger().Error("persist run failed", "controller", ctrl, "run_id", r.RunID, "err", err)
		return err
	}
	return nil
}

// unixToISO renders a device wall-clock unix-seconds stamp as the RFC3339 text the
// ledger stores (matching the other ts columns, so the /usage range filter works).
// 0 (clock never trusted) -> "" so it sorts before any real window.
func unixToISO(secs int64) string {
	if secs <= 0 {
		return ""
	}
	return time.Unix(secs, 0).UTC().Format(time.RFC3339)
}

// HighWaterRun returns the highest persisted run (epoch, seq) for a controller —
// the value published retained on RunsAckTopic so the device can drop every
// outbox entry at or below it. run_id encodes (epoch, seq), so the lexical max of
// (epoch, seq) is the monotonic high-water-mark even across epochs.
func HighWaterRun(app core.App, ctrl string) (epoch, seq int64, ok bool) {
	recs, err := app.FindRecordsByFilter("runs", "controller = {:c}", "-epoch,-seq", 1, 0,
		dbx.Params{"c": ctrl})
	if err != nil || len(recs) == 0 {
		return 0, 0, false
	}
	return int64(recs[0].GetInt("epoch")), int64(recs[0].GetInt("seq")), true
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
