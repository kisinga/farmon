// Package automations serializes a site's automation rows per controller into the
// retained packed-binary message the firmware runtime engine consumes, and
// republishes it on any change. The browser stamps route_index/route_set_version
// onto the rows (route derivation is browser-only); the server stays a dumb pipe.
//
// The wire layout MUST match src/lib/automation-wire.ts and the firmware struct in
// src/lib/codegen/generators/automation-engine.ts. The TS reference encoder's
// golden vector (test/automation-wire.test.ts) is the cross-language spec; the
// Go encoder test here checks against the same bytes.
package automations

import (
	"crypto/sha256"
	"encoding/binary"
	"encoding/hex"
	"encoding/json"

	"github.com/kisinga/majiflow/internal/telemetry"
	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/core"
)

const (
	wireMagic      uint16 = 0xa001
	headerBytes           = 6
	recordBytes           = 20
	idBytes               = 16 // whole automation id, null-padded, appended after the records
	maxAutomations        = 32
)

// Publisher is the subset of the MQTT broker the publish hook needs.
type Publisher interface {
	Publish(topic string, payload []byte, retain bool, qos byte) error
}

// Item is one automation in plain values — the unit the wire encoder works on,
// independent of PocketBase so the byte layout is testable against the TS golden
// vector (test/automation-wire.test.ts).
type Item struct {
	ID                string // whole PocketBase id, echoed back as a route's origin actor
	Enabled           bool
	Trigger           string // "time" | "level"
	DaysMask          int
	LevelThresholdPct int
	RouteIndex        int
	TimeMin           int
	OverrideMask      int
	OvSourceMinPct    int
	OvDestMaxPct      int
	OvMaxRuntimeMin   int
	OvTargetDurationS int
	OvTargetVolumeL   int
}

func itemFromRecord(r *core.Record) Item {
	return Item{
		ID:                r.Id,
		Enabled:           r.GetBool("enabled"),
		Trigger:           r.GetString("trigger_type"),
		DaysMask:          r.GetInt("days_mask"),
		LevelThresholdPct: r.GetInt("level_threshold_pct"),
		RouteIndex:        r.GetInt("route_index"),
		TimeMin:           r.GetInt("time_min"),
		OverrideMask:      r.GetInt("override_mask"),
		OvSourceMinPct:    r.GetInt("ov_source_min_pct"),
		OvDestMaxPct:      r.GetInt("ov_dest_max_pct"),
		OvMaxRuntimeMin:   r.GetInt("ov_max_runtime_min"),
		OvTargetDurationS: r.GetInt("ov_target_duration_s"),
		OvTargetVolumeL:   r.GetInt("ov_target_volume_l"),
	}
}

// EncodeItems packs the header + records little-endian. An empty slice yields a
// valid 6-byte header with count 0 (a clear), never a zero-length payload. The
// layout mirrors src/lib/automation-wire.ts byte-for-byte.
func EncodeItems(routeSetVersion uint16, items []Item) []byte {
	count := len(items)
	if count > maxAutomations {
		count = maxAutomations
	}
	buf := make([]byte, headerBytes+count*recordBytes+count*idBytes)
	binary.LittleEndian.PutUint16(buf[0:], wireMagic)
	binary.LittleEndian.PutUint16(buf[2:], routeSetVersion)
	buf[4] = byte(count)
	buf[5] = 0
	o := headerBytes
	for i := 0; i < count; i++ {
		a := items[i]
		b := buf[o:]
		b[0] = boolByte(a.Enabled)
		b[1] = triggerByte(a.Trigger)
		b[2] = byte(a.DaysMask)
		b[3] = u8(a.LevelThresholdPct)
		binary.LittleEndian.PutUint16(b[4:], uint16(a.RouteIndex))
		binary.LittleEndian.PutUint16(b[6:], uint16(a.TimeMin))
		b[8] = byte(a.OverrideMask)
		b[9] = u8(a.OvSourceMinPct)
		b[10] = u8(a.OvDestMaxPct)
		b[11] = 0
		binary.LittleEndian.PutUint16(b[12:], uint16(a.OvMaxRuntimeMin))
		binary.LittleEndian.PutUint16(b[14:], uint16(a.OvTargetDurationS))
		binary.LittleEndian.PutUint32(b[16:], uint32(a.OvTargetVolumeL))
		o += recordBytes
	}
	// Trailing id block: one fixed 16-byte ascii field per record (null-padded).
	for i := 0; i < count; i++ {
		id := items[i].ID
		for j := 0; j < idBytes-1 && j < len(id); j++ {
			buf[o+j] = id[j] & 0x7f
		}
		o += idBytes
	}
	return buf
}

// Encode packs PocketBase automation records into the wire format.
func Encode(routeSetVersion uint16, rows []*core.Record) []byte {
	items := make([]Item, len(rows))
	for i, r := range rows {
		items[i] = itemFromRecord(r)
	}
	return EncodeItems(routeSetVersion, items)
}

// PublishForController serializes all automations for {site, ctrl} and publishes
// the retained set to that controller's topic. The route_set_version rides from
// the rows (browser-stamped, consistent per controller); 0 for an empty set.
func PublishForController(app core.App, pub Publisher, site, ctrl string) error {
	rows, err := app.FindRecordsByFilter(
		"automations",
		"site = {:s} && controller = {:c}",
		"created", maxAutomations, 0,
		dbx.Params{"s": site, "c": ctrl},
	)
	if err != nil {
		return err
	}
	var version uint16
	if len(rows) > 0 {
		version = uint16(rows[0].GetInt("route_set_version"))
	}
	payload := Encode(version, rows)
	return pub.Publish(telemetry.AutomationsTopic(site, ctrl), payload, true, 1)
}

// Register binds the republish hook to every automations change. DB is the source
// of truth; any create/update/delete republishes the whole per-controller set
// (tiny payload, last-write-wins on the retained topic, zero reconciliation).
func Register(app core.App, pub Publisher) {
	publish := func(e *core.RecordEvent) error {
		if err := e.Next(); err != nil {
			return err
		}
		site := e.Record.GetString("site")
		ctrl := e.Record.GetString("controller")
		if site != "" && ctrl != "" {
			if err := PublishForController(e.App, pub, site, ctrl); err != nil {
				e.App.Logger().Error("automations republish failed", "site", site, "controller", ctrl, "error", err)
			}
		}
		return nil
	}
	app.OnRecordAfterCreateSuccess("automations").BindFunc(publish)
	app.OnRecordAfterUpdateSuccess("automations").BindFunc(publish)
	app.OnRecordAfterDeleteSuccess("automations").BindFunc(publish)
}

// --- Desired controller config (tunables + calibration) ---------------------
//
// The dashboard writes the desired key→value bag to the controller_config row; the
// server is the only hasher. CanonicalConfig serializes that bag deterministically
// and PublishConfigForController stamps the sha256 hex `version` and republishes the
// retained /config message. The device applies it and echoes `version` back as the
// snapshot text `config_version`; the reconcile loop re-pushes on a desired-vs-applied
// mismatch. config_set is gone — this retained message is the only config delivery.

// configMessage is the retained /config wire shape: an opaque server-computed
// `version` plus the canonical desired-config object the device applies. The device
// never hashes — it round-trips `version` verbatim as the snapshot `config_version`.
type configMessage struct {
	Version string          `json:"version"`
	Config  json.RawMessage `json:"config"`
}

// CanonicalConfig renders the desired key→value bag into deterministic JSON — the
// exact bytes the version hashes over and the `config` member of the retained
// message. Determinism comes from Go's encoding/json sorting map keys; a nil/empty
// bag canonicalizes to `{}`. Exported so a Go unit test can pin the canonical bytes
// (the only hash test needed: the device round-trips the opaque version, so there is
// no cross-language golden vector). Keep this the single canonicalization point.
func CanonicalConfig(desired map[string]any) []byte {
	if desired == nil {
		desired = map[string]any{}
	}
	b, err := json.Marshal(desired)
	if err != nil {
		return []byte("{}")
	}
	return b
}

// ConfigVersion is the server-side version: the sha256 hex of the canonical bytes.
// Computed ONLY here, at publish time; embedded as `version` in the retained
// message and round-tripped by the device. Exported alongside CanonicalConfig so the
// canonical-stability unit test pins both halves.
func ConfigVersion(canonical []byte) string {
	sum := sha256.Sum256(canonical)
	return hex.EncodeToString(sum[:])
}

// EncodeConfig builds the retained /config payload from a desired bag and returns it
// with the computed version, so the publish path can stamp the version onto the row
// and emit the same bytes the device sees.
func EncodeConfig(desired map[string]any) (payload []byte, version string) {
	canonical := CanonicalConfig(desired)
	version = ConfigVersion(canonical)
	payload, err := json.Marshal(configMessage{Version: version, Config: canonical})
	if err != nil {
		return canonical, version
	}
	return payload, version
}

// PublishConfigForController recomputes the canonical payload + version for a
// controller's desired config, stamps the version back onto the row when it moved,
// and publishes the retained /config message (QoS 1). The DB is the source of truth;
// last-write-wins on the retained topic. A missing row publishes the empty-config
// message (a clear), never a zero-length payload.
func PublishConfigForController(app core.App, pub Publisher, site, ctrl string) error {
	rec, _ := app.FindFirstRecordByFilter("controller_config",
		"controller = {:c}", dbx.Params{"c": ctrl})

	var desired map[string]any
	if rec != nil {
		// `desired` is stored as opaque JSON; decode to the canonical bag. A malformed
		// or absent value canonicalizes to {} rather than failing the publish.
		_ = json.Unmarshal([]byte(rec.GetString("desired")), &desired)
	}

	payload, version := EncodeConfig(desired)

	// Stamp the freshly-computed version back onto the row (server is the only hasher),
	// so the reconcile loop can compare it against the device-reported applied_version.
	if rec != nil && rec.GetString("version") != version {
		rec.Set("version", version)
		_ = app.Save(rec)
	}

	return pub.Publish(telemetry.ConfigTopic(site, ctrl), payload, true, 1)
}

// RegisterConfig binds the republish hook to every controller_config change. The
// dashboard writes the desired bag; any create/update republishes the retained
// /config message with the server-computed version (last-write-wins on the topic,
// zero reconciliation in the steady state). This generalizes the automations
// republish: one DB write -> one server recompute -> one retained delivery.
func RegisterConfig(app core.App, pub Publisher) {
	publish := func(e *core.RecordEvent) error {
		if err := e.Next(); err != nil {
			return err
		}
		site := e.Record.GetString("site")
		ctrl := e.Record.GetString("controller")
		if site != "" && ctrl != "" {
			if err := PublishConfigForController(e.App, pub, site, ctrl); err != nil {
				e.App.Logger().Error("config republish failed", "site", site, "controller", ctrl, "error", err)
			}
		}
		return nil
	}
	app.OnRecordAfterCreateSuccess("controller_config").BindFunc(publish)
	app.OnRecordAfterUpdateSuccess("controller_config").BindFunc(publish)
	// Delete clears the retained /config: PublishConfigForController finds no row and
	// publishes the empty-config message, so a removed (or site-cascade-deleted) row
	// doesn't strand stale settings on the device's retained topic.
	app.OnRecordAfterDeleteSuccess("controller_config").BindFunc(publish)
}

func boolByte(b bool) byte {
	if b {
		return 1
	}
	return 0
}

func triggerByte(t string) byte {
	if t == "level" {
		return 1
	}
	return 0
}

func u8(v int) byte {
	if v < 0 {
		return 0
	}
	if v > 255 {
		return 255
	}
	return byte(v)
}
