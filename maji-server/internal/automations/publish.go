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
	"encoding/binary"

	"github.com/kisinga/majiflow/internal/telemetry"
	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/core"
)

const (
	wireMagic      uint16 = 0xa001
	headerBytes           = 6
	recordBytes           = 20
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
	buf := make([]byte, headerBytes+count*recordBytes)
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
