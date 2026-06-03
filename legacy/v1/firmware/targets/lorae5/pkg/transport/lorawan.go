// Package transport provides the LoRaWAN implementation of transport.Transport.
// Fully synchronous — no goroutines or channels — compatible with -scheduler=none.
package transport

import (
	"github.com/kisinga/farmon/firmware/pkg/transport"
	"github.com/kisinga/farmon/firmware/targets/lorae5/pkg/radio"
)

// LoRaWANTransport adapts radio.Radio to the transport.Transport interface.
type LoRaWANTransport struct {
	rad       *radio.Radio
	confirmed bool
	rxBuf     [4]transport.Packet
	rxCount   uint8
	rxHead    uint8
}

// Compile-time interface check.
var _ transport.Transport = (*LoRaWANTransport)(nil)

// New creates a LoRaWANTransport wrapping the given Radio.
func New(rad *radio.Radio, confirmed bool) *LoRaWANTransport {
	return &LoRaWANTransport{
		rad:       rad,
		confirmed: confirmed,
	}
}

// Send transmits an uplink packet via LoRaWAN. Blocks through TX and RX windows.
// Any received downlink is buffered for Recv().
func (t *LoRaWANTransport) Send(p transport.Packet) bool {
	if !t.rad.IsJoined() {
		return false
	}
	ok := t.rad.SendUplink(p.Payload[:p.Len])
	if !ok {
		return false
	}

	// Buffer any downlink received during the RX windows.
	rx := t.rad.LastRx()
	if rx.Valid && t.rxCount < uint8(len(t.rxBuf)) {
		idx := (t.rxHead + t.rxCount) % uint8(len(t.rxBuf))
		t.rxBuf[idx] = transport.Packet{Port: rx.Port, Len: rx.Len}
		copy(t.rxBuf[idx].Payload[:], rx.Payload[:rx.Len])
		t.rxCount++
	}
	return true
}

// Recv returns the next buffered downlink packet, or false if none.
func (t *LoRaWANTransport) Recv() (transport.Packet, bool) {
	if t.rxCount == 0 {
		return transport.Packet{}, false
	}
	p := t.rxBuf[t.rxHead]
	t.rxHead = (t.rxHead + 1) % uint8(len(t.rxBuf))
	t.rxCount--
	return p, true
}

// IsReady reports whether the radio has completed OTAA join.
func (t *LoRaWANTransport) IsReady() bool {
	return t.rad.IsJoined()
}
