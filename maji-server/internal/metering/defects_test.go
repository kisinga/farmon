package metering

import (
	"encoding/hex"
	"errors"
	"net"
	"testing"
	"time"

	"github.com/kisinga/majiflow/internal/config"
	_ "github.com/kisinga/majiflow/migrations"
	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tests"
)

// setupDefectTest boots a bare test app (no UDP listener) for the unit-style
// defect tests that drive listener internals directly.
func setupDefectTest(t *testing.T) *tests.TestApp {
	t.Helper()
	app, err := tests.NewTestApp()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(app.Cleanup)
	return app
}

func markSent(t *testing.T, app core.App, cmd *core.Record, attempts int) *core.Record {
	t.Helper()
	cmd.Set("status", "sent")
	cmd.Set("attempts", attempts)
	cmd.Set("sent_at", time.Now().UTC())
	if err := app.Save(cmd); err != nil {
		t.Fatal(err)
	}
	return cmd
}

func findEvent(t *testing.T, app core.App, meterID, typ string) *core.Record {
	t.Helper()
	ev, err := app.FindFirstRecordByFilter("meter_events",
		"meter = {:m} && type = {:t}", dbx.Params{"m": meterID, "t": typ})
	if err != nil || ev == nil {
		t.Fatalf("expected a %s meter_events row: %v", typ, err)
	}
	return ev
}

// ExpireOrphanedSent: commands stranded in 'sent' by a restart are expired
// with an event; queued commands are untouched.
func TestExpireOrphanedSent(t *testing.T) {
	app := setupDefectTest(t)
	site := seedSite(t, app)
	meter := seedMeter(t, app, site.Id, fixtureIMEI, fixtureSN, "open")

	sent := markSent(t, app, mustEnqueue(t, app, meter, CmdValveClose), 1)
	// A queued command on a second meter must survive the sweep.
	m2 := seedMeter(t, app, site.Id, "867724031768409", "987654321", "open")
	queued := mustEnqueue(t, app, m2, CmdValveOpen)

	if err := ExpireOrphanedSent(app, time.Now().UTC()); err != nil {
		t.Fatal(err)
	}

	rec, err := app.FindRecordById("meter_commands", sent.Id)
	if err != nil {
		t.Fatal(err)
	}
	if got := rec.GetString("status"); got != "expired" {
		t.Fatalf("orphaned sent status = %q, want expired", got)
	}
	ev := findEvent(t, app, meter.Id, "command_expired")
	if got := ev.GetString("severity"); got != "warning" {
		t.Errorf("event severity = %q, want warning", got)
	}

	rec, err = app.FindRecordById("meter_commands", queued.Id)
	if err != nil {
		t.Fatal(err)
	}
	if got := rec.GetString("status"); got != "queued" {
		t.Fatalf("queued status after sweep = %q, want queued", got)
	}
}

func mustEnqueue(t *testing.T, app core.App, meter *core.Record, cmdType string) *core.Record {
	t.Helper()
	cmd, err := EnqueueCommand(app, meter, cmdType, nil, "tester", "admin")
	if err != nil {
		t.Fatal(err)
	}
	return cmd
}

// requeueExpiredAcks below the attempts cap returns the command to the queue.
func TestRequeueExpiredAcksBelowCap(t *testing.T) {
	app := setupDefectTest(t)
	site := seedSite(t, app)
	meter := seedMeter(t, app, site.Id, fixtureIMEI, fixtureSN, "open")
	cmd := markSent(t, app, mustEnqueue(t, app, meter, CmdValveClose), 1)

	l := &listener{app: app, cfg: config.Config{}, pending: map[string]*pendingAck{
		meter.Id: {cmdID: cmd.Id, meterID: meter.Id, deadline: time.Now().Add(-time.Second)},
	}}
	l.requeueExpiredAcks()

	rec, err := app.FindRecordById("meter_commands", cmd.Id)
	if err != nil {
		t.Fatal(err)
	}
	if got := rec.GetString("status"); got != "queued" {
		t.Fatalf("status below cap = %q, want queued", got)
	}
	if len(l.pending) != 0 {
		t.Fatalf("pending table still holds %d entries", len(l.pending))
	}
}

// requeueExpiredAcks at the attempts cap fails the command and records a
// critical event (the owner alert is best-effort and not asserted).
func TestRequeueExpiredAcksAtCap(t *testing.T) {
	app := setupDefectTest(t)
	site := seedSite(t, app)
	meter := seedMeter(t, app, site.Id, fixtureIMEI, fixtureSN, "open")
	cmd := markSent(t, app, mustEnqueue(t, app, meter, CmdValveClose), 3)

	l := &listener{app: app, cfg: config.Config{}, pending: map[string]*pendingAck{
		meter.Id: {cmdID: cmd.Id, meterID: meter.Id, deadline: time.Now().Add(-time.Second)},
	}}
	l.requeueExpiredAcks()

	rec, err := app.FindRecordById("meter_commands", cmd.Id)
	if err != nil {
		t.Fatal(err)
	}
	if got := rec.GetString("status"); got != "failed" {
		t.Fatalf("status at cap = %q, want failed", got)
	}
	if got := rec.GetString("error"); got != "ack timeout: max attempts reached" {
		t.Errorf("error = %q, want ack timeout message", got)
	}
	ev := findEvent(t, app, meter.Id, "command_failed")
	if got := ev.GetString("severity"); got != "critical" {
		t.Errorf("event severity = %q, want critical", got)
	}
}

// The attempts cap is per-site policy (billing_settings.cmd_max_attempts):
// a site with a higher cap keeps requeueing where the default would fail.
func TestRequeueExpiredAcksSiteCapOverride(t *testing.T) {
	app := setupDefectTest(t)
	site := seedSite(t, app)
	meter := seedMeter(t, app, site.Id, fixtureIMEI, fixtureSN, "open")
	cmd := markSent(t, app, mustEnqueue(t, app, meter, CmdValveClose), 3)

	settingsColl, err := app.FindCollectionByNameOrId("billing_settings")
	if err != nil {
		t.Fatal(err)
	}
	settings := core.NewRecord(settingsColl)
	settings.Set("site", site.Id)
	settings.Set("cmd_max_attempts", 5)
	if err := app.Save(settings); err != nil {
		t.Fatal(err)
	}

	l := &listener{app: app, cfg: config.Config{}, pending: map[string]*pendingAck{
		meter.Id: {cmdID: cmd.Id, meterID: meter.Id, deadline: time.Now().Add(-time.Second)},
	}}
	l.requeueExpiredAcks()

	rec, err := app.FindRecordById("meter_commands", cmd.Id)
	if err != nil {
		t.Fatal(err)
	}
	if got := rec.GetString("status"); got != "queued" {
		t.Fatalf("status at default cap but below site cap = %q, want queued", got)
	}
}

// flushOne marks the command sent and bumps its attempts counter.
func TestFlushOneIncrementsAttempts(t *testing.T) {
	app, addr := setupMeterTest(t)
	site := seedSite(t, app)
	meter := seedMeter(t, app, site.Id, fixtureIMEI, fixtureSN, "open")
	cmd, err := EnqueueValve(app, meter, true, "tester", "admin")
	if err != nil {
		t.Fatal(err)
	}

	dev := newDeviceConn(t)
	sendHex(t, dev, addr, fixtureFrames[0]) // uplink → session flushes the command
	_ = readFrame(t, dev)                   // time-calib
	_ = readFrame(t, dev)                   // valve_close

	waitFor(t, "command sent with attempts=1", func() bool {
		rec, err := app.FindRecordById("meter_commands", cmd.Id)
		return err == nil && rec.GetString("status") == "sent" && rec.GetInt("attempts") == 1
	})
}

// craftValveAck builds a command-result frame carrying the device IMEI and a
// /81/0 key-0 valve command echo (1=close, 0=open).
func craftValveAck(t *testing.T, id uint16, imei string, echo uint64) Frame {
	t.Helper()
	payload, err := (Objects{
		{uint64(KeyValveCmd): echo, "bn": BnValve},
		{uint64(KeyIMEI): imei, "bn": BnNetwork},
	}).Encode()
	if err != nil {
		t.Fatal(err)
	}
	return Frame{Type: TypeResponse, Func: FuncCmdResult, ID: id, Payload: payload}
}

func setupResolveAck(t *testing.T, app core.App, meter *core.Record, cmd *core.Record) *listener {
	t.Helper()
	return &listener{app: app, cfg: config.Config{MeterCmdWindowMs: 2000}, pending: map[string]*pendingAck{
		meter.Id: {
			cmdID:   cmd.Id,
			meterID: meter.Id,
			imei:    meter.GetString("imei"),
			src:     &net.UDPAddr{IP: net.ParseIP("127.0.0.1"), Port: 9999},
			srcIP:   "127.0.0.1",
		},
	}}
}

// resolveAck with a matching valve echo acks the command, updates valve_state
// and persists the raw ack payload.
func TestResolveAckMatchingEcho(t *testing.T) {
	app := setupDefectTest(t)
	site := seedSite(t, app)
	meter := seedMeter(t, app, site.Id, fixtureIMEI, fixtureSN, "open")
	cmd := markSent(t, app, mustEnqueue(t, app, meter, CmdValveClose), 1)
	l := setupResolveAck(t, app, meter, cmd)

	ack := craftValveAck(t, 100, fixtureIMEI, 1) // echoed close for a close
	l.resolveAck(ack, &net.UDPAddr{IP: net.ParseIP("127.0.0.1"), Port: 9999})

	rec, err := app.FindRecordById("meter_commands", cmd.Id)
	if err != nil {
		t.Fatal(err)
	}
	if got := rec.GetString("status"); got != "acked" {
		t.Fatalf("status = %q, want acked", got)
	}
	if got, want := rec.GetString("ack_raw"), hex.EncodeToString(ack.Payload); got != want {
		t.Errorf("ack_raw = %q, want %q", got, want)
	}
	m, err := app.FindRecordById("meter_devices", meter.Id)
	if err != nil {
		t.Fatal(err)
	}
	if got := m.GetString("valve_state"); got != "closed" {
		t.Errorf("valve_state = %q, want closed", got)
	}
}

// resolveAck with a mismatching echo fails the command, records a critical
// event, and leaves valve_state untouched.
func TestResolveAckMismatchingEcho(t *testing.T) {
	app := setupDefectTest(t)
	site := seedSite(t, app)
	meter := seedMeter(t, app, site.Id, fixtureIMEI, fixtureSN, "open")
	cmd := markSent(t, app, mustEnqueue(t, app, meter, CmdValveClose), 1)
	l := setupResolveAck(t, app, meter, cmd)

	l.resolveAck(craftValveAck(t, 101, fixtureIMEI, 0), &net.UDPAddr{IP: net.ParseIP("127.0.0.1"), Port: 9999})

	rec, err := app.FindRecordById("meter_commands", cmd.Id)
	if err != nil {
		t.Fatal(err)
	}
	if got := rec.GetString("status"); got != "failed" {
		t.Fatalf("status = %q, want failed", got)
	}
	if got := rec.GetString("error"); got == "" {
		t.Error("expected a mismatch error message")
	}
	ev := findEvent(t, app, meter.Id, "command_failed")
	if got := ev.GetString("severity"); got != "critical" {
		t.Errorf("event severity = %q, want critical", got)
	}
	m, err := app.FindRecordById("meter_devices", meter.Id)
	if err != nil {
		t.Fatal(err)
	}
	if got := m.GetString("valve_state"); got != "open" {
		t.Errorf("valve_state = %q, want untouched (open)", got)
	}
}

// resolveAck with no /81/0 object in the ack falls back to trusting the ack
// (live-device validation of the echo is still pending).
func TestResolveAckNoEchoFallback(t *testing.T) {
	app := setupDefectTest(t)
	site := seedSite(t, app)
	meter := seedMeter(t, app, site.Id, fixtureIMEI, fixtureSN, "open")
	cmd := markSent(t, app, mustEnqueue(t, app, meter, CmdValveClose), 1)
	l := setupResolveAck(t, app, meter, cmd)

	l.resolveAck(craftAck(t, 102, fixtureIMEI), &net.UDPAddr{IP: net.ParseIP("127.0.0.1"), Port: 9999})

	rec, err := app.FindRecordById("meter_commands", cmd.Id)
	if err != nil {
		t.Fatal(err)
	}
	if got := rec.GetString("status"); got != "acked" {
		t.Fatalf("status = %q, want acked (fallback)", got)
	}
	m, err := app.FindRecordById("meter_devices", meter.Id)
	if err != nil {
		t.Fatal(err)
	}
	if got := m.GetString("valve_state"); got != "closed" {
		t.Errorf("valve_state = %q, want closed", got)
	}
}

// EnqueueValve: a second valve command while one is pending is refused —
// by the pre-check, and by the partial unique index when the pre-check is
// bypassed.
func TestEnqueueValvePendingRefused(t *testing.T) {
	app := setupDefectTest(t)
	site := seedSite(t, app)
	meter := seedMeter(t, app, site.Id, fixtureIMEI, fixtureSN, "open")

	if _, err := EnqueueValve(app, meter, true, "tester", "admin"); err != nil {
		t.Fatal(err)
	}
	// Pre-check path (same direction, so the no-change guard doesn't fire).
	if _, err := EnqueueValve(app, meter, true, "tester", "admin"); !errors.Is(err, ErrValvePending) {
		t.Fatalf("second EnqueueValve err = %v, want ErrValvePending", err)
	}
	// Index path: bypassing the pre-check still fails at the DB layer with a
	// recognizable unique violation.
	if _, err := EnqueueCommand(app, meter, CmdValveOpen, nil, "tester", "admin"); !isUniqueViolation(err) {
		t.Fatalf("direct duplicate enqueue err = %v, want unique violation", err)
	}
	// A non-valve command is NOT covered by the partial index.
	if _, err := EnqueueCommand(app, meter, CmdSetInterval, map[string]any{"seconds": 3600}, "tester", "admin"); err != nil {
		t.Fatalf("set_interval enqueue alongside pending valve: %v", err)
	}
}

// persistReading swallows a dedupe-index violation (a replay the pre-check
// missed) instead of logging an error or losing the row.
func TestPersistReadingDuplicateViaIndex(t *testing.T) {
	app := setupDefectTest(t)
	site := seedSite(t, app)
	meter := seedMeter(t, app, site.Id, fixtureIMEI, fixtureSN, "open")
	l := &listener{app: app, cfg: config.Config{}}

	raw, err := hex.DecodeString(fixtureFrames[0])
	if err != nil {
		t.Fatal(err)
	}
	f, err := ParseFrame(raw)
	if err != nil {
		t.Fatal(err)
	}
	objs, err := DecodeObjects(f.Payload)
	if err != nil {
		t.Fatal(err)
	}
	litres, ts, ok := objs.Reading()
	if !ok {
		t.Fatal("fixture carries no reading")
	}
	now := time.Now().UTC()
	l.persistReading(meter, f, objs, raw, "127.0.0.1", now, litres, ts)
	l.persistReading(meter, f, objs, raw, "127.0.0.1", now, litres, ts) // replay

	if got := countReadings(t, app, meter.Id); got != 1 {
		t.Fatalf("readings after replayed persist = %d, want 1", got)
	}
}
