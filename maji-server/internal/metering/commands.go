package metering

import (
	"fmt"
	"log"
	"strings"
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

// isUniqueViolation reports whether err is a unique-constraint violation
// (e.g. the pending-valve partial index or the readings dedupe index).
// PocketBase converts SQLite UNIQUE failures into validator errors of the
// form "meter: Value must be unique." (one entry per indexed column) —
// verified against the test app; the raw "UNIQUE constraint failed" driver
// string never reaches the caller.
func isUniqueViolation(err error) bool {
	return err != nil && strings.Contains(err.Error(), "Value must be unique")
}

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
	rec, err := PendingValve(app, meterID)
	return err == nil && rec != nil
}

// PendingValve returns the meter's in-flight valve command (queued, or sent
// but not yet acked), or (nil, nil) when none. Callers that act on the
// pending command's direction (e.g. cancelling a queued close after payment)
// use this instead of HasPendingValve.
func PendingValve(app core.App, meterID string) (*core.Record, error) {
	recs, err := app.FindRecordsByFilter("meter_commands",
		"meter = {:m} && (status = 'queued' || status = 'sent') && (type = 'valve_open' || type = 'valve_close')",
		"-created", 1, 0, dbx.Params{"m": meterID})
	if err != nil || len(recs) == 0 {
		return nil, err
	}
	return recs[0], nil
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

// defaultCmdMaxAttempts applies when a site has no billing_settings row or a
// non-positive cmd_max_attempts.
const defaultCmdMaxAttempts = 3

// maxCmdAttempts reads the per-site send-attempts cap from billing_settings
// (cmd_max_attempts). It is evaluated per command — DB-level policy that
// takes effect immediately, no restart. Falls back to the default when the
// site has no settings row or a non-positive value.
func maxCmdAttempts(app core.App, siteID string) int {
	if siteID != "" {
		s, err := app.FindFirstRecordByFilter("billing_settings", "site = {:s}", dbx.Params{"s": siteID})
		if err == nil && s != nil {
			if n := s.GetInt("cmd_max_attempts"); n > 0 {
				return n
			}
		}
	}
	return defaultCmdMaxAttempts
}

// ExpireOrphanedSent sweeps commands left in 'sent' by a server restart (the
// pending-ack table is in-memory, so a restart strands them: nothing will
// ever requeue or ack them). Each is marked expired with a meter_events row.
// Called once from StartListener before the packet loop starts.
func ExpireOrphanedSent(app core.App, now time.Time) error {
	recs, err := app.FindRecordsByFilter("meter_commands",
		"status = 'sent'", "created", 500, 0)
	if err != nil {
		return err
	}
	if len(recs) == 500 {
		log.Printf("metering: orphaned sent sweep: page full (500) — more 'sent' rows may remain")
	}
	for _, rec := range recs {
		rec.Set("status", "expired")
		if err := app.Save(rec); err != nil {
			return err
		}
		insertEvent(app, rec.GetString("site"), rec.GetString("meter"),
			"command_expired", "warning",
			fmt.Sprintf("command %s (%s) expired: server restarted with the command in flight (ack never observed)", rec.Id, rec.GetString("type")),
			now)
	}
	return nil
}
