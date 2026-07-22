package metering

import (
	"encoding/hex"
	"encoding/json"
	"log"
	"net"
	"strconv"
	"time"

	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/core"
)

// ingestUplink is the per-packet pipeline for telemetry reports (spec §4):
// identify → dedupe → persist → update meter → trust check → session.
func (l *listener) ingestUplink(f Frame, raw []byte, src *net.UDPAddr) {
	objs, err := DecodeObjects(f.Payload)
	if err != nil {
		log.Printf("metering: bad CBOR from %s: %v", src, err)
		return
	}
	now := time.Now().UTC()
	srcIP := src.IP.String()

	meter, err := findMeter(l.app, objs.IMEI(), objs.SN())
	if err != nil {
		log.Printf("metering: meter lookup: %v", err)
		return
	}
	if meter == nil {
		l.recordSighting(objs, raw, srcIP, now)
		// The device expects a time-calib reply even before it is claimed
		// (spec §3.3 step 2) — send it, then stop (no reading, no commands).
		if sn := objs.SN(); sn != "" {
			l.sendTo(BuildTimeCalibFrame(randMsgID(), sn, now, l.cfg.MeterTZ), src)
		}
		return
	}

	// Previous source IP for the trust check, captured BEFORE touchMeter
	// rewrites raw_last.
	prevIP := rawLastSourceIP(meter)

	litres, ts, hasReading := objs.Reading()
	if hasReading {
		dup, err := l.readingExists(meter.Id, f.ID, ts)
		if err != nil {
			// Dedupe is the only guard against replay; on DB error skip
			// persistence rather than relying on the unique index to catch it.
			log.Printf("metering: dedupe check meter %s: %v", meter.Id, err)
		} else if !dup {
			l.persistReading(meter, f, objs, raw, srcIP, now, litres, ts)
		}
	}
	l.touchMeter(meter, objs, srcIP, now, litres, ts, hasReading)

	// Trust check (spec §4 step 7): no wire auth exists, so flag when a known
	// meter suddenly reports from a different source IP. Skipped on the first
	// uplink (no previous IP recorded).
	if prevIP != "" && prevIP != srcIP {
		insertEvent(l.app, meter.GetString("site"), meter.Id, "new_source_ip", "warning",
			"meter "+meter.GetString("imei")+" reported from new source IP "+srcIP+" (was "+prevIP+")", now)
	}

	l.runSession(meter, objs, src)
}

// findMeter resolves a meter by IMEI (the wire identity, unique), falling
// back to SN. Returns (nil, nil) when the device is unknown.
func findMeter(app core.App, imei, sn string) (*core.Record, error) {
	if imei != "" {
		rec, err := app.FindFirstRecordByFilter("meter_devices", "imei = {:i}", dbx.Params{"i": imei})
		if err == nil && rec != nil {
			return rec, nil
		}
	}
	if sn != "" {
		rec, err := app.FindFirstRecordByFilter("meter_devices", "sn = {:s}", dbx.Params{"s": sn})
		if err == nil && rec != nil {
			return rec, nil
		}
	}
	return nil, nil
}

// recordSighting upserts a meter_sightings row for an unknown device so an
// operator can claim it later. Keyed by IMEI when present, else SN.
func (l *listener) recordSighting(objs Objects, raw []byte, srcIP string, now time.Time) {
	imei, sn := objs.IMEI(), objs.SN()
	var rec *core.Record
	if imei != "" {
		rec, _ = l.app.FindFirstRecordByFilter("meter_sightings", "imei = {:i}", dbx.Params{"i": imei})
	}
	if rec == nil && sn != "" {
		rec, _ = l.app.FindFirstRecordByFilter("meter_sightings", "sn = {:s}", dbx.Params{"s": sn})
	}
	if rec == nil {
		coll, err := l.app.FindCollectionByNameOrId("meter_sightings")
		if err != nil {
			log.Printf("metering: sightings collection: %v", err)
			return
		}
		rec = core.NewRecord(coll)
		rec.Set("status", "unclaimed")
		rec.Set("first_seen", now)
	}
	rec.Set("imei", imei)
	rec.Set("sn", sn)
	rec.Set("source_ip", srcIP)
	rec.Set("raw_cbor", objectsJSON(objs))
	rec.Set("raw_hex", hex.EncodeToString(raw))
	rec.Set("last_seen", now)
	if err := l.app.Save(rec); err != nil {
		log.Printf("metering: save sighting: %v", err)
		return
	}
	log.Printf("metering: unclaimed device (imei=%q sn=%q) from %s", imei, sn, srcIP)
}

// readingExists is the replay dedupe: the wire's message ID is a random
// 16-bit value, so the idempotency key is (meter, message_id, device_ts).
func (l *listener) readingExists(meterID string, msgID uint16, ts time.Time) (bool, error) {
	recs, err := l.app.FindRecordsByFilter("meter_readings",
		"meter = {:m} && message_id = {:id}", "-created", 20, 0,
		dbx.Params{"m": meterID, "id": int(msgID)})
	if err != nil {
		return false, err
	}
	for _, r := range recs {
		if r.GetDateTime("device_ts").Time().Equal(ts) {
			return true, nil
		}
	}
	return false, nil
}

// persistReading appends the immutable reading (millilitres — the wire
// reports litres, converted at ingest per the architecture §5 invariant).
func (l *listener) persistReading(meter *core.Record, f Frame, objs Objects, raw []byte, srcIP string, now time.Time, litres uint64, ts time.Time) {
	coll, err := l.app.FindCollectionByNameOrId("meter_readings")
	if err != nil {
		log.Printf("metering: readings collection: %v", err)
		return
	}
	rec := core.NewRecord(coll)
	rec.Set("site", meter.GetString("site"))
	rec.Set("meter", meter.Id)
	rec.Set("device_ts", ts)
	rec.Set("received_at", now)
	rec.Set("cumulative_ml", int64(litres)*1000)
	rec.Set("message_id", int(f.ID))
	rec.Set("signal", signalJSON(objs))
	rec.Set("raw_cbor", objectsJSON(objs))
	rec.Set("raw_hex", hex.EncodeToString(raw))
	if err := l.app.Save(rec); err != nil {
		log.Printf("metering: save reading: %v", err)
	}
}

// touchMeter rolls the uplink into the meter row: last-seen markers, the
// latest reading, the reported valve state, model, and the raw payload +
// source IP (raw_last also feeds the new-source-IP trust check).
func (l *listener) touchMeter(meter *core.Record, objs Objects, srcIP string, now time.Time, litres uint64, ts time.Time, hasReading bool) {
	meter.Set("last_uplink_at", now)
	if hasReading {
		meter.Set("last_reading_ml", int64(litres)*1000)
		meter.Set("last_reading_at", ts)
	}
	// /81/0 key 3 semantics are unverified (1 seen on an open valve — see
	// objects.go ValveState). The ack-derived state (resolveAck) is
	// authoritative, so the provisional uplink mapping only fills "unknown" —
	// otherwise an uplink after an acked close would flip the state back.
	if st, ok := objs.ValveState(); ok && meter.GetString("valve_state") == "unknown" {
		switch st {
		case 1:
			meter.Set("valve_state", "open")
		case 0:
			meter.Set("valve_state", "closed")
		}
	}
	if m := objs.Model(); m != "" && meter.GetString("model") == "" {
		meter.Set("model", m)
	}
	meter.Set("raw_last", map[string]any{
		"objects":   objectsJSON(objs),
		"source_ip": srcIP,
	})
	if err := l.app.Save(meter); err != nil {
		log.Printf("metering: save meter %s: %v", meter.Id, err)
	}
}

// insertEvent appends a meter_events row (health/security timeline).
func insertEvent(app core.App, siteID, meterID, typ, severity, message string, occurredAt time.Time) {
	coll, err := app.FindCollectionByNameOrId("meter_events")
	if err != nil {
		log.Printf("metering: events collection: %v", err)
		return
	}
	rec := core.NewRecord(coll)
	rec.Set("site", siteID)
	rec.Set("meter", meterID)
	rec.Set("type", typ)
	rec.Set("severity", severity)
	rec.Set("message", message)
	rec.Set("occurred_at", occurredAt)
	if err := app.Save(rec); err != nil {
		log.Printf("metering: save event: %v", err)
	}
}

// rawLastSourceIP extracts the last-seen source IP stored by touchMeter.
func rawLastSourceIP(meter *core.Record) string {
	raw, err := json.Marshal(meter.Get("raw_last"))
	if err != nil {
		return ""
	}
	var m map[string]any
	if err := json.Unmarshal(raw, &m); err != nil {
		return ""
	}
	s, _ := m["source_ip"].(string)
	return s
}

// objectsJSON converts decoded CBOR objects into a JSON-safe structure:
// integer keys are rendered as decimal strings ("bn" stays a text key).
func objectsJSON(objs Objects) []any {
	out := make([]any, 0, len(objs))
	for _, m := range objs {
		out = append(out, objectJSON(m))
	}
	return out
}

func objectJSON(m Object) map[string]any {
	out := make(map[string]any, len(m))
	for k, v := range m {
		switch kk := k.(type) {
		case string:
			out[kk] = v
		case uint64:
			out[strconv.FormatUint(kk, 10)] = v
		case int64:
			out[strconv.FormatInt(kk, 10)] = v
		}
	}
	return out
}

// signalJSON is the /99/0 network object minus the IMEI. The signal metric
// keys (11/13/14: rsrp/snr) are unverified — stored raw (spec §9).
func signalJSON(objs Objects) map[string]any {
	m := objs.Find(BnNetwork)
	if m == nil {
		return nil
	}
	out := objectJSON(m)
	delete(out, strconv.Itoa(KeyIMEI))
	return out
}
