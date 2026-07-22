package metering

import (
	"bytes"
	"errors"
	"log"
	"net"
	"time"

	"github.com/kisinga/majiflow/internal/config"
	"github.com/pocketbase/pocketbase/core"
)

// listener is the Shengda meter UDP endpoint. A single goroutine (loop) owns
// the socket and the pending-ack table, so no locking is needed: ingestion,
// sessions, ack matching, and ack timeouts all run serialized per packet.
type listener struct {
	app  core.App
	cfg  config.Config
	conn *net.UDPConn
	// pending holds sent-but-unacked commands, keyed by meter id (one
	// outstanding command per meter). Only loop touches it.
	pending map[string]*pendingAck
}

// StartListener binds the meter UDP socket and launches the packet loop and
// the command-expiry sweeper. Returns an error if the bind fails.
func StartListener(app core.App, cfg config.Config) error {
	l, err := newListener(app, cfg)
	if err != nil {
		return err
	}
	go l.loop()
	go RunExpirySweeper(app, cfg.MeterCmdTTLH)
	log.Printf("metering: UDP listener on %s (cmd window %dms, cmd TTL %dh)",
		l.conn.LocalAddr(), cfg.MeterCmdWindowMs, cfg.MeterCmdTTLH)
	return nil
}

// newListener binds the socket without starting the loop (tests drive it).
func newListener(app core.App, cfg config.Config) (*listener, error) {
	addr, err := net.ResolveUDPAddr("udp", cfg.MeterUDPAddr)
	if err != nil {
		return nil, err
	}
	conn, err := net.ListenUDP("udp", addr)
	if err != nil {
		return nil, err
	}
	return &listener{app: app, cfg: cfg, conn: conn, pending: map[string]*pendingAck{}}, nil
}

// close shuts the socket down; loop exits on the resulting read error.
func (l *listener) close() error {
	return l.conn.Close()
}

// loop reads datagrams forever. The read deadline tracks the earliest pending
// ack so an ack timeout requeues its command even when traffic goes quiet.
func (l *listener) loop() {
	buf := make([]byte, maxFrameSize+512)
	for {
		l.armReadDeadline()
		n, src, err := l.conn.ReadFromUDP(buf)
		if err != nil {
			if errors.Is(err, net.ErrClosed) {
				return
			}
			var nerr net.Error
			if errors.As(err, &nerr) && nerr.Timeout() {
				l.requeueExpiredAcks()
				continue
			}
			log.Printf("metering: read: %v", err)
			continue
		}
		l.handlePacketSafe(bytes.Clone(buf[:n]), src)
	}
}

// armReadDeadline sets the read deadline to the earliest pending-ack expiry,
// or clears it when nothing is outstanding (blocking read).
func (l *listener) armReadDeadline() {
	var earliest time.Time
	for _, p := range l.pending {
		if earliest.IsZero() || p.deadline.Before(earliest) {
			earliest = p.deadline
		}
	}
	_ = l.conn.SetReadDeadline(earliest) // zero = no deadline
}

// handlePacketSafe isolates per-packet failures: a panic while handling one
// datagram must never kill the listener.
func (l *listener) handlePacketSafe(pkt []byte, src *net.UDPAddr) {
	defer func() {
		if r := recover(); r != nil {
			log.Printf("metering: panic handling packet from %s: %v", src, r)
		}
	}()
	l.handlePacket(pkt, src)
}

func (l *listener) handlePacket(pkt []byte, src *net.UDPAddr) {
	f, err := ParseFrame(pkt)
	if err != nil {
		log.Printf("metering: bad frame from %s: %v", src, err)
		return
	}
	switch {
	case f.Type == TypeUplink && f.Func == FuncUplink:
		l.ingestUplink(f, pkt, src)
	case f.Type == TypeResponse && f.Func == FuncCmdResult:
		l.resolveAck(f, src)
	default:
		log.Printf("metering: ignoring frame type=0x%02x func=0x%02x from %s", f.Type, f.Func, src)
	}
}

// sendTo serializes f and writes it to dst.
func (l *listener) sendTo(f Frame, dst *net.UDPAddr) error {
	_, err := l.conn.WriteToUDP(f.Build(), dst)
	return err
}
