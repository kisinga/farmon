package metering

import (
	"crypto/rand"
	"encoding/binary"
	"encoding/hex"
	"fmt"
	"log"
	"net"
	"time"

	"github.com/kisinga/majiflow/internal/alerts"
	"github.com/pocketbase/pocketbase/core"
)

// pendingAck is a sent command awaiting its execution-result frame.
type pendingAck struct {
	cmdID    string
	meterID  string
	imei     string
	src      *net.UDPAddr // where to reach the meter for the rest of the window
	srcIP    string
	deadline time.Time
}

// runSession executes the downlink half of a contact (spec §3.3): the
// immediate time-calibration reply, then ONE queued command. The ack arrives
// as a later datagram and is matched by resolveAck — the session never blocks
// the packet loop, so interleaved meters cannot stall each other (the 20s
// hard cap is met trivially: a session is two sends).
func (l *listener) runSession(meter *core.Record, objs Objects, src *net.UDPAddr) {
	if sn := objs.SN(); sn != "" {
		// The SN must echo the device's own serial or it ignores the reply.
		if err := l.sendTo(BuildTimeCalibFrame(randMsgID(), sn, time.Now().UTC(), l.cfg.MeterTZ), src); err != nil {
			log.Printf("metering: time-calib to %s: %v", src, err)
		}
	}
	l.flushOne(meter, src)
}

// flushOne sends the meter's oldest queued command when nothing is
// outstanding. Called at session start and again from resolveAck (spec §3.3
// step 4: on ack → next queued command, while the window is still open).
func (l *listener) flushOne(meter *core.Record, src *net.UDPAddr) {
	// One outstanding command per meter: a previous send still awaits its ack.
	if _, busy := l.pending[meter.Id]; busy {
		return
	}
	cmd, err := NextQueued(l.app, meter.Id)
	if err != nil || cmd == nil {
		return
	}

	imei := meter.GetString("imei")
	var f Frame
	switch cmd.GetString("type") {
	case "valve_close":
		f = BuildValveFrame(randMsgID(), imei, true)
	case "valve_open":
		f = BuildValveFrame(randMsgID(), imei, false)
	case "set_interval":
		f = BuildSetIntervalFrame(randMsgID(), imei, payloadSeconds(cmd))
	default:
		cmd.Set("status", "failed")
		cmd.Set("error", "unsupported command type: "+cmd.GetString("type"))
		if err := l.app.Save(cmd); err != nil {
			log.Printf("metering: fail command %s: %v", cmd.Id, err)
		}
		return
	}

	if err := l.sendTo(f, src); err != nil {
		// Never left the server — keep it queued for the next contact.
		log.Printf("metering: send command %s to %s: %v", cmd.Id, src, err)
		return
	}
	now := time.Now().UTC()
	cmd.Set("status", "sent")
	cmd.Set("sent_at", now)
	cmd.Set("attempts", cmd.GetInt("attempts")+1)
	if err := l.app.Save(cmd); err != nil {
		log.Printf("metering: mark command %s sent: %v", cmd.Id, err)
	}
	l.pending[meter.Id] = &pendingAck{
		cmdID:    cmd.Id,
		meterID:  meter.Id,
		imei:     imei,
		src:      src,
		srcIP:    src.IP.String(),
		deadline: now.Add(time.Duration(l.cfg.MeterCmdWindowMs) * time.Millisecond),
	}
}

// resolveAck matches a command-result frame to the outstanding command.
// Meters behind carrier-grade NAT can share a source IP, so the ack's own
// IMEI is the primary key; the source IP is the fallback for acks whose
// payload doesn't decode — but only when it identifies ONE pending command
// unambiguously (two meters sharing an IP make the fallback a guess that
// could ack the wrong valve).
func (l *listener) resolveAck(f Frame, src *net.UDPAddr) {
	// Always decode what we can: the objects drive IMEI matching and the
	// valve-command echo verification. A decode error leaves objs nil — the
	// ack is then handled by the source-IP fallback, as before.
	objs, _ := DecodeObjects(f.Payload)
	imei := ""
	if objs != nil {
		imei = objs.IMEI()
	}
	var pa *pendingAck
	if imei != "" {
		for _, p := range l.pending {
			if p.imei == imei {
				pa = p
				break
			}
		}
	}
	if pa == nil {
		for _, p := range l.pending {
			if p.srcIP != src.IP.String() {
				continue
			}
			if pa != nil {
				log.Printf("metering: command result from %s is ambiguous (shared source IP, no IMEI); ignoring", src)
				return
			}
			pa = p
		}
	}
	if pa == nil {
		log.Printf("metering: command result from %s matches no pending command", src)
		return
	}
	delete(l.pending, pa.meterID)

	cmd, err := l.app.FindRecordById("meter_commands", pa.cmdID)
	if err != nil || cmd == nil {
		log.Printf("metering: ack for unknown command %s", pa.cmdID)
		return
	}
	now := time.Now().UTC()
	// Keep the raw payload for live-device validation of the echo semantics.
	cmd.Set("ack_raw", hex.EncodeToString(f.Payload))

	// Echo verification: when the ack carries /81/0 key 0 (the valve command
	// echo — 1=close, 0=open per the vendor fixtures), it must match the
	// command we sent. A mismatch means the meter executed (or reports)
	// something else: fail loudly, leave valve_state untouched, and stop the
	// queue rather than flushing the next command into a confused session.
	if echo, ok := valveCmdEcho(objs); ok {
		if want, check := expectedValveEcho(cmd.GetString("type")); check && echo != want {
			cmd.Set("status", "failed")
			cmd.Set("error", fmt.Sprintf("ack echo mismatch: sent %s but meter echoed valve cmd %d", cmd.GetString("type"), echo))
			if err := l.app.Save(cmd); err != nil {
				log.Printf("metering: mark command %s failed: %v", cmd.Id, err)
			}
			insertEvent(l.app, cmd.GetString("site"), cmd.GetString("meter"),
				"command_failed", "critical",
				fmt.Sprintf("command %s (%s) ack echo mismatch: meter echoed valve cmd %d", cmd.Id, cmd.GetString("type"), echo),
				now)
			log.Printf("metering: command %s (%s) ack echo mismatch (echoed %d) from meter %s",
				cmd.Id, cmd.GetString("type"), echo, pa.meterID)
			// A mismatch signals device misbehavior — alert the owners too
			// (goroutine: alerting does network I/O, never block the loop).
			go l.alertCommandFailed(cmd)
			return
		}
	}

	cmd.Set("status", "acked")
	cmd.Set("acked_at", now)
	if err := l.app.Save(cmd); err != nil {
		log.Printf("metering: mark command %s acked: %v", cmd.Id, err)
	}

	// An acked valve command is the authoritative state change (the uplink's
	// own /81/0 report is unverified — see touchMeter).
	var state string
	switch cmd.GetString("type") {
	case "valve_close":
		state = "closed"
	case "valve_open":
		state = "open"
	}
	meter, merr := l.app.FindRecordById("meter_devices", pa.meterID)
	if state != "" && merr == nil && meter != nil {
		meter.Set("valve_state", state)
		if err := l.app.Save(meter); err != nil {
			log.Printf("metering: save meter %s valve state: %v", pa.meterID, err)
		}
	}
	log.Printf("metering: command %s (%s) acked by meter %s", cmd.Id, cmd.GetString("type"), pa.meterID)

	// The window is still open: flush the next queued command (spec §3.3
	// step 4) so a backlog drains in one contact, not one command per day.
	if merr == nil && meter != nil {
		l.flushOne(meter, pa.src)
	}
}

// requeueExpiredAcks returns timed-out commands to the queue; they are
// retried at the meter's next contact (spec §3.3 step 4). A command that has
// exhausted the site's billing_settings.cmd_max_attempts is failed instead,
// with a critical event and a best-effort alert to the site owners.
func (l *listener) requeueExpiredAcks() {
	now := time.Now()
	for _, p := range l.pending {
		if now.Before(p.deadline) {
			continue
		}
		delete(l.pending, p.meterID)
		cmd, err := l.app.FindRecordById("meter_commands", p.cmdID)
		if err != nil || cmd == nil {
			continue
		}
		if max := maxCmdAttempts(l.app, cmd.GetString("site")); cmd.GetInt("attempts") >= max {
			cmd.Set("status", "failed")
			cmd.Set("error", "ack timeout: max attempts reached")
			if err := l.app.Save(cmd); err != nil {
				log.Printf("metering: fail command %s: %v", p.cmdID, err)
			}
			insertEvent(l.app, cmd.GetString("site"), cmd.GetString("meter"),
				"command_failed", "critical",
				fmt.Sprintf("command %s (%s) failed: no ack after %d attempt(s)", cmd.Id, cmd.GetString("type"), cmd.GetInt("attempts")),
				now)
			log.Printf("metering: command %s (meter %s) failed: no ack after %d attempt(s)",
				p.cmdID, p.meterID, cmd.GetInt("attempts"))
			// Alerting does network I/O (SMTP/HTTP) — never block the packet
			// loop on it.
			go l.alertCommandFailed(cmd)
			continue
		}
		cmd.Set("status", "queued")
		if err := l.app.Save(cmd); err != nil {
			log.Printf("metering: requeue command %s: %v", p.cmdID, err)
		}
		log.Printf("metering: ack timeout for command %s (meter %s); requeued", p.cmdID, p.meterID)
	}
}

// alertCommandFailed notifies the site's owners that a command can no longer
// be delivered. Best-effort: any failure is logged, never propagated — this
// runs inside the packet loop.
func (l *listener) alertCommandFailed(cmd *core.Record) {
	emails := siteOwnerEmails(l.app, cmd.GetString("site"))
	if len(emails) == 0 {
		return
	}
	subject := "Meter command failed: " + cmd.GetString("type")
	body := fmt.Sprintf(
		"Command %s (%s) for meter %s was sent %d time(s) without an acknowledgement from the meter and has been marked failed. The meter may be unreachable; investigate its connectivity.",
		cmd.Id, cmd.GetString("type"), cmd.GetString("meter"), cmd.GetInt("attempts"))
	if err := alerts.SendExternal(l.app, emails, nil, subject, body); err != nil {
		log.Printf("metering: alert command %s failure: %v", cmd.Id, err)
	}
}

// siteOwnerEmails resolves the emails of a site's co-owners (sites.owner is
// a multi-relation to users). Failures return what could be resolved.
func siteOwnerEmails(app core.App, siteID string) []string {
	if siteID == "" {
		return nil
	}
	site, err := app.FindRecordById("sites", siteID)
	if err != nil || site == nil {
		return nil
	}
	var emails []string
	for _, uid := range site.GetStringSlice("owner") {
		u, err := app.FindRecordById("users", uid)
		if err == nil && u != nil {
			if e := u.GetString("email"); e != "" {
				emails = append(emails, e)
			}
		}
	}
	return emails
}

// valveCmdEcho extracts the /81/0 key-0 valve command echo from an ack
// payload (1=close, 0=open per the vendor fixtures; flagged for live-unit
// validation). ok is false when the ack carries no such echo.
func valveCmdEcho(objs Objects) (uint64, bool) {
	if m := objs.Find(BnValve); m != nil {
		return m.num(KeyValveCmd)
	}
	return 0, false
}

// expectedValveEcho maps a valve command type to the echo value the meter
// should report; ok is false for non-valve commands (nothing to verify).
func expectedValveEcho(cmdType string) (uint64, bool) {
	switch cmdType {
	case CmdValveClose:
		return 1, true
	case CmdValveOpen:
		return 0, true
	}
	return 0, false
}

// payloadSeconds reads the interval argument of a set_interval command.
func payloadSeconds(cmd *core.Record) uint64 {
	m, ok := cmd.Get("payload").(map[string]any)
	if !ok {
		return 0
	}
	switch v := m["seconds"].(type) {
	case float64:
		return uint64(v)
	case int64:
		return uint64(v)
	case uint64:
		return v
	}
	return 0
}

// randMsgID returns a random message ID in the protocol range 1-65535.
func randMsgID() uint16 {
	var b [2]byte
	if _, err := rand.Read(b[:]); err != nil {
		// crypto/rand never fails on supported platforms; fall back to a
		// time-derived value rather than panicking in the packet loop.
		return uint16(time.Now().UnixNano()%65535 + 1)
	}
	return binary.BigEndian.Uint16(b[:])%65535 + 1
}
