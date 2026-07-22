package metering

import (
	"fmt"
	"log"
	"time"

	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/core"
)

// Command types (meter_commands.type select values).
const (
	CmdValveOpen   = "valve_open"
	CmdValveClose  = "valve_close"
	CmdSetInterval = "set_interval"
)

// EnqueueCommand appends a command to the meter's FIFO downlink queue. It is
// delivered at the meter's next contact (the meter sleeps between uplinks).
func EnqueueCommand(app core.App, meter *core.Record, cmdType string, payload map[string]any, queuedBy, queuedRole string) (*core.Record, error) {
	coll, err := app.FindCollectionByNameOrId("meter_commands")
	if err != nil {
		return nil, err
	}
	rec := core.NewRecord(coll)
	rec.Set("site", meter.GetString("site"))
	rec.Set("meter", meter.Id)
	rec.Set("type", cmdType)
	if payload != nil {
		rec.Set("payload", payload)
	}
	rec.Set("status", "queued")
	rec.Set("queued_by", queuedBy)
	rec.Set("queued_role", queuedRole)
	if err := app.Save(rec); err != nil {
		return nil, err
	}
	return rec, nil
}

// NextQueued returns the oldest queued command for the meter (FIFO), or
// (nil, nil) when the queue is empty.
func NextQueued(app core.App, meterID string) (*core.Record, error) {
	recs, err := app.FindRecordsByFilter("meter_commands",
		"meter = {:m} && status = 'queued'", "created", 1, 0,
		dbx.Params{"m": meterID})
	if err != nil {
		return nil, err
	}
	if len(recs) == 0 {
		return nil, nil
	}
	return recs[0], nil
}

// HasPendingValve reports whether a valve command is already in flight
// (queued, or sent but not yet acked) for the meter.
func HasPendingValve(app core.App, meterID string) bool {
	recs, err := app.FindRecordsByFilter("meter_commands",
		"meter = {:m} && (status = 'queued' || status = 'sent') && (type = 'valve_open' || type = 'valve_close')",
		"-created", 1, 0, dbx.Params{"m": meterID})
	return err == nil && len(recs) > 0
}

// RunExpirySweeper expires stale commands every 5 minutes. Fire-and-forget
// like the other service goroutines: it lives for the process.
func RunExpirySweeper(app core.App, ttlHours int) {
	ttl := time.Duration(ttlHours) * time.Hour
	t := time.NewTicker(5 * time.Minute)
	defer t.Stop()
	for now := range t.C {
		if err := expireStale(app, ttl, now); err != nil {
			log.Printf("metering: expiry sweep: %v", err)
		}
	}
}

// expireStale marks QUEUED commands older than ttl as expired (vendor cache
// semantics: an unsent command is dead after the TTL) and logs a meter_events
// row per command. 'sent' commands are excluded — their ack may simply be
// late; the listener's ack timeout already requeues those. now is injectable
// for tests.
func expireStale(app core.App, ttl time.Duration, now time.Time) error {
	recs, err := app.FindRecordsByFilter("meter_commands",
		"status = 'queued'", "created", 500, 0)
	if err != nil {
		return err
	}
	for _, rec := range recs {
		created := rec.GetDateTime("created").Time()
		if created.IsZero() || created.Add(ttl).After(now) {
			continue
		}
		rec.Set("status", "expired")
		if err := app.Save(rec); err != nil {
			return err
		}
		insertEvent(app, rec.GetString("site"), rec.GetString("meter"),
			"command_expired", "warning",
			fmt.Sprintf("command %s (%s) expired undelivered after %s", rec.Id, rec.GetString("type"), ttl),
			now)
	}
	return nil
}
