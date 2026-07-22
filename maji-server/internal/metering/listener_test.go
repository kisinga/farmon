package metering

import (
	"encoding/hex"
	"net"
	"testing"
	"time"

	"github.com/kisinga/majiflow/internal/config"
	_ "github.com/kisinga/majiflow/migrations"
	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tests"
)

const (
	fixtureIMEI = "867724031768408"
	fixtureSN   = "123456789"
)

// setupMeterTest boots a test app and a real UDP listener on 127.0.0.1:0.
func setupMeterTest(t *testing.T) (*tests.TestApp, *net.UDPAddr) {
	t.Helper()
	app, err := tests.NewTestApp()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(app.Cleanup)
	cfg := config.Config{
		Mode:             config.ModeCloud,
		MeterUDPAddr:     "127.0.0.1:0",
		MeterCmdWindowMs: 2000,
		MeterCmdTTLH:     48,
		MeterTZ:          "UTC+3",
	}
	l, err := newListener(app, cfg)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = l.close() })
	go l.loop()
	return app, l.conn.LocalAddr().(*net.UDPAddr)
}

func seedSite(t *testing.T, app core.App) *core.Record {
	t.Helper()
	coll, err := app.FindCollectionByNameOrId("sites")
	if err != nil {
		t.Fatal(err)
	}
	site := core.NewRecord(coll)
	site.Set("name", "Meter Test Site")
	if err := app.Save(site); err != nil {
		t.Fatal(err)
	}
	return site
}

func seedMeter(t *testing.T, app core.App, siteID, imei, sn, valveState string) *core.Record {
	t.Helper()
	coll, err := app.FindCollectionByNameOrId("meter_devices")
	if err != nil {
		t.Fatal(err)
	}
	m := core.NewRecord(coll)
	m.Set("site", siteID)
	m.Set("imei", imei)
	m.Set("sn", sn)
	m.Set("valve_capable", true)
	m.Set("valve_state", valveState)
	m.Set("status", "active")
	m.Set("comm_type", "nb_iot")
	if err := app.Save(m); err != nil {
		t.Fatal(err)
	}
	return m
}

// newDeviceConn is the simulated meter: an unconnected UDP socket so the
// source port stays stable across sends.
func newDeviceConn(t *testing.T) *net.UDPConn {
	t.Helper()
	c, err := net.ListenUDP("udp", &net.UDPAddr{IP: net.ParseIP("127.0.0.1")})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = c.Close() })
	return c
}

func sendHex(t *testing.T, c *net.UDPConn, addr *net.UDPAddr, hexFrame string) {
	t.Helper()
	data, err := hex.DecodeString(hexFrame)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := c.WriteToUDP(data, addr); err != nil {
		t.Fatal(err)
	}
}

func sendFrame(t *testing.T, c *net.UDPConn, addr *net.UDPAddr, f Frame) {
	t.Helper()
	if _, err := c.WriteToUDP(f.Build(), addr); err != nil {
		t.Fatal(err)
	}
}

func readFrame(t *testing.T, c *net.UDPConn) Frame {
	t.Helper()
	if err := c.SetReadDeadline(time.Now().Add(3 * time.Second)); err != nil {
		t.Fatal(err)
	}
	buf := make([]byte, 2048)
	n, err := c.Read(buf)
	if err != nil {
		t.Fatalf("device read: %v", err)
	}
	f, err := ParseFrame(buf[:n])
	if err != nil {
		t.Fatalf("device parse reply: %v", err)
	}
	return f
}

func waitFor(t *testing.T, what string, cond func() bool) {
	t.Helper()
	deadline := time.Now().Add(3 * time.Second)
	for time.Now().Before(deadline) {
		if cond() {
			return
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatalf("timeout waiting for %s", what)
}

func countReadings(t *testing.T, app core.App, meterID string) int {
	t.Helper()
	recs, err := app.FindRecordsByFilter("meter_readings", "meter = {:m}", "", 0, 0, dbx.Params{"m": meterID})
	if err != nil {
		t.Fatal(err)
	}
	return len(recs)
}

// craftUplink builds a variant of the fixture uplink with a different device
// identity (and message ID), for multi-device and unclaimed-device tests.
func craftUplink(t *testing.T, id uint16, imei, sn string) Frame {
	t.Helper()
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
	if m := objs.Find(BnDevice); m != nil {
		m[uint64(KeySN)] = sn
	}
	if m := objs.Find(BnNetwork); m != nil {
		m[uint64(KeyIMEI)] = imei
	}
	payload, err := objs.Encode()
	if err != nil {
		t.Fatal(err)
	}
	return Frame{Type: TypeUplink, Func: FuncUplink, ID: id, Payload: payload}
}

// craftAck builds a command-result frame carrying the given device IMEI.
func craftAck(t *testing.T, id uint16, imei string) Frame {
	t.Helper()
	payload, err := (Objects{{uint64(KeyIMEI): imei, "bn": BnNetwork}}).Encode()
	if err != nil {
		t.Fatal(err)
	}
	return Frame{Type: TypeResponse, Func: FuncCmdResult, ID: id, Payload: payload}
}

// Full session (spec §8.2): uplink → time-calib → queued valve_close on the
// wire → ack → command acked and valve_state closed. Then a replayed uplink
// must not duplicate the reading.
func TestSessionValveCloseAckAndReplay(t *testing.T) {
	app, addr := setupMeterTest(t)
	site := seedSite(t, app)
	meter := seedMeter(t, app, site.Id, fixtureIMEI, fixtureSN, "open")

	cmd, err := EnqueueValve(app, meter, true, "tester", "admin")
	if err != nil {
		t.Fatal(err)
	}

	dev := newDeviceConn(t)
	sendHex(t, dev, addr, fixtureFrames[0]) // uplink

	// 1. Time-calib comes first and must echo the device SN.
	calib := readFrame(t, dev)
	if calib.Type != TypeResponse || calib.Func != FuncTimeCalib {
		t.Fatalf("first reply: type=0x%02x func=0x%02x, want time-calib", calib.Type, calib.Func)
	}
	cobjs, err := DecodeObjects(calib.Payload)
	if err != nil {
		t.Fatal(err)
	}
	if got := cobjs.SN(); got != fixtureSN {
		t.Errorf("time-calib SN = %q, want %q", got, fixtureSN)
	}

	// 2. The queued valve_close is flushed in the same session.
	ctrl := readFrame(t, dev)
	if ctrl.Type != TypeUplink || ctrl.Func != FuncControl {
		t.Fatalf("second reply: type=0x%02x func=0x%02x, want control", ctrl.Type, ctrl.Func)
	}
	oobjs, err := DecodeObjects(ctrl.Payload)
	if err != nil {
		t.Fatal(err)
	}
	valve := oobjs.Find(BnValve)
	if valve == nil {
		t.Fatal("control frame missing /81/0 object")
	}
	if cmdByte, ok := valve.num(KeyValveCmd); !ok || cmdByte != 1 {
		t.Errorf("valve cmd = %v (ok=%v), want 1 (close)", cmdByte, ok)
	}
	if got := valve.str(22); got != fixtureIMEI {
		t.Errorf("control frame IMEI = %q, want %q", got, fixtureIMEI)
	}

	// 3. Ack it (the vendor fixture command-result carries the fixture IMEI).
	sendHex(t, dev, addr, fixtureFrames[4])

	waitFor(t, "command acked", func() bool {
		rec, err := app.FindRecordById("meter_commands", cmd.Id)
		return err == nil && rec.GetString("status") == "acked"
	})
	waitFor(t, "valve_state closed", func() bool {
		m, err := app.FindRecordById("meter_devices", meter.Id)
		return err == nil && m.GetString("valve_state") == "closed"
	})

	// The uplink's reading was persisted exactly once (millilitres).
	if got := countReadings(t, app, meter.Id); got != 1 {
		t.Fatalf("readings after first uplink = %d, want 1", got)
	}
	reading, err := app.FindFirstRecordByFilter("meter_readings", "meter = {:m}", dbx.Params{"m": meter.Id})
	if err != nil {
		t.Fatal(err)
	}
	if got, want := reading.GetInt("cumulative_ml"), 9999999*1000; got != want {
		t.Errorf("cumulative_ml = %d, want %d", got, want)
	}
	if got := reading.GetInt("message_id"); got != 0xcfbd {
		t.Errorf("message_id = %d, want %d", got, 0xcfbd)
	}

	// 4. Replay the exact same datagram: no duplicate reading (idempotent).
	sendHex(t, dev, addr, fixtureFrames[0])
	_ = readFrame(t, dev) // the session still replies with a time-calib
	time.Sleep(200 * time.Millisecond)
	if got := countReadings(t, app, meter.Id); got != 1 {
		t.Fatalf("readings after replay = %d, want 1", got)
	}
}

// Two meters in overlapping sessions must not cross-talk (spec §8.3): each
// gets its own time-calib and its own queued command, and acks resolve by IMEI.
func TestInterleavedSessions(t *testing.T) {
	app, addr := setupMeterTest(t)
	site := seedSite(t, app)
	m1 := seedMeter(t, app, site.Id, fixtureIMEI, fixtureSN, "open")
	m2 := seedMeter(t, app, site.Id, "867724031768409", "987654321", "closed")

	cmd1, err := EnqueueValve(app, m1, true, "tester", "admin")
	if err != nil {
		t.Fatal(err)
	}
	cmd2, err := EnqueueValve(app, m2, false, "tester", "admin")
	if err != nil {
		t.Fatal(err)
	}

	dev1, dev2 := newDeviceConn(t), newDeviceConn(t)

	// Both uplinks are in flight before either ack arrives.
	sendHex(t, dev1, addr, fixtureFrames[0])
	sendFrame(t, dev2, addr, craftUplink(t, 2222, "867724031768409", "987654321"))

	// Device 1: time-calib (own SN) + close.
	if got := mustSN(t, readFrame(t, dev1)); got != fixtureSN {
		t.Errorf("dev1 time-calib SN = %q, want %q", got, fixtureSN)
	}
	if got := mustValveCmd(t, readFrame(t, dev1)); got != 1 {
		t.Errorf("dev1 valve cmd = %d, want 1 (close)", got)
	}
	// Device 2: time-calib (own SN) + open.
	if got := mustSN(t, readFrame(t, dev2)); got != "987654321" {
		t.Errorf("dev2 time-calib SN = %q, want %q", got, "987654321")
	}
	if got := mustValveCmd(t, readFrame(t, dev2)); got != 0 {
		t.Errorf("dev2 valve cmd = %d, want 0 (open)", got)
	}

	// Ack in reverse order; matching is by the ack's IMEI, not the source.
	sendFrame(t, dev2, addr, craftAck(t, 3333, "867724031768409"))
	sendFrame(t, dev1, addr, craftAck(t, 4444, fixtureIMEI))

	waitFor(t, "cmd2 acked", func() bool {
		rec, err := app.FindRecordById("meter_commands", cmd2.Id)
		return err == nil && rec.GetString("status") == "acked"
	})
	waitFor(t, "cmd1 acked", func() bool {
		rec, err := app.FindRecordById("meter_commands", cmd1.Id)
		return err == nil && rec.GetString("status") == "acked"
	})
	waitFor(t, "meter states settled", func() bool {
		r1, e1 := app.FindRecordById("meter_devices", m1.Id)
		r2, e2 := app.FindRecordById("meter_devices", m2.Id)
		return e1 == nil && e2 == nil &&
			r1.GetString("valve_state") == "closed" && r2.GetString("valve_state") == "open"
	})
}

func mustSN(t *testing.T, f Frame) string {
	t.Helper()
	if f.Type != TypeResponse || f.Func != FuncTimeCalib {
		t.Fatalf("frame type=0x%02x func=0x%02x, want time-calib", f.Type, f.Func)
	}
	objs, err := DecodeObjects(f.Payload)
	if err != nil {
		t.Fatal(err)
	}
	return objs.SN()
}

func mustValveCmd(t *testing.T, f Frame) uint64 {
	t.Helper()
	if f.Type != TypeUplink || f.Func != FuncControl {
		t.Fatalf("frame type=0x%02x func=0x%02x, want control", f.Type, f.Func)
	}
	objs, err := DecodeObjects(f.Payload)
	if err != nil {
		t.Fatal(err)
	}
	v := objs.Find(BnValve)
	if v == nil {
		t.Fatal("control frame missing /81/0")
	}
	cmd, ok := v.num(KeyValveCmd)
	if !ok {
		t.Fatal("control frame missing valve cmd key")
	}
	return cmd
}

// Command TTL (spec §8.4): a queued command older than the TTL is expired and
// an operator-facing event is recorded. Fresh commands stay queued.
func TestCommandExpiry(t *testing.T) {
	app, _ := setupMeterTest(t)
	site := seedSite(t, app)
	meter := seedMeter(t, app, site.Id, fixtureIMEI, fixtureSN, "open")

	cmd, err := EnqueueCommand(app, meter, CmdValveClose, nil, "tester", "admin")
	if err != nil {
		t.Fatal(err)
	}

	// Within TTL: untouched.
	if err := expireStale(app, 48*time.Hour, time.Now().UTC()); err != nil {
		t.Fatal(err)
	}
	rec, err := app.FindRecordById("meter_commands", cmd.Id)
	if err != nil {
		t.Fatal(err)
	}
	if got := rec.GetString("status"); got != "queued" {
		t.Fatalf("status within TTL = %q, want queued", got)
	}

	// Past TTL: expired + event.
	if err := expireStale(app, 48*time.Hour, time.Now().UTC().Add(49*time.Hour)); err != nil {
		t.Fatal(err)
	}
	rec, err = app.FindRecordById("meter_commands", cmd.Id)
	if err != nil {
		t.Fatal(err)
	}
	if got := rec.GetString("status"); got != "expired" {
		t.Fatalf("status past TTL = %q, want expired", got)
	}
	ev, err := app.FindFirstRecordByFilter("meter_events",
		"meter = {:m} && type = 'command_expired'", dbx.Params{"m": meter.Id})
	if err != nil || ev == nil {
		t.Fatal("expected a command_expired meter_events row")
	}
	if got := ev.GetString("severity"); got != "warning" {
		t.Errorf("event severity = %q, want warning", got)
	}
}

// Unknown devices (spec §4 step 2): a sighting is recorded, no reading is
// persisted, but the time-calib reply still goes out.
func TestUnclaimedDeviceSighting(t *testing.T) {
	app, addr := setupMeterTest(t)

	dev := newDeviceConn(t)
	sendFrame(t, dev, addr, craftUplink(t, 7777, "111222333444555", "555666777"))

	calib := readFrame(t, dev)
	if calib.Type != TypeResponse || calib.Func != FuncTimeCalib {
		t.Fatalf("reply type=0x%02x func=0x%02x, want time-calib", calib.Type, calib.Func)
	}
	objs, err := DecodeObjects(calib.Payload)
	if err != nil {
		t.Fatal(err)
	}
	if got := objs.SN(); got != "555666777" {
		t.Errorf("time-calib SN = %q, want %q", got, "555666777")
	}

	waitFor(t, "sighting recorded", func() bool {
		rec, err := app.FindFirstRecordByFilter("meter_sightings", "imei = {:i}", dbx.Params{"i": "111222333444555"})
		return err == nil && rec != nil && rec.GetString("status") == "unclaimed"
	})
	sighting, _ := app.FindFirstRecordByFilter("meter_sightings", "imei = {:i}", dbx.Params{"i": "111222333444555"})
	if got := sighting.GetString("sn"); got != "555666777" {
		t.Errorf("sighting sn = %q, want %q", got, "555666777")
	}

	recs, err := app.FindRecordsByFilter("meter_readings", "id != ''", "", 0, 0)
	if err != nil {
		t.Fatal(err)
	}
	if len(recs) != 0 {
		t.Fatalf("readings for unclaimed device = %d, want 0", len(recs))
	}
}
