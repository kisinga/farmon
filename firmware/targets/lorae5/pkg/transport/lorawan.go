// Package transport provides the LoRaWAN implementation of transport.Transport.
// It wraps the radio.Radio goroutine behind the shared interface so main.go
// only calls Transport methods rather than touching radio channels directly.
package transport

import (
	"github.com/farmon/firmware/pkg/transport"
	"github.com/farmon/firmware/targets/lorae5/pkg/radio"
)

// LoRaWANTransport adapts radio.Radio to the transport.Transport interface.
type LoRaWANTransport struct {
	rad       *radio.Radio
	rxChan    chan transport.Packet
	confirmed bool
}

// Compile-time interface check.
var _ transport.Transport = (*LoRaWANTransport)(nil)

// New creates a LoRaWANTransport wrapping the given Radio.
// confirmed controls whether uplinks request a LoRaWAN ACK.
func New(rad *radio.Radio, confirmed bool) *LoRaWANTransport {
	t := &LoRaWANTransport{
		rad:       rad,
		rxChan:    make(chan transport.Packet, 4),
		confirmed: confirmed,
	}
	go t.bridgeRx()
	return t
}

// Send enqueues a packet for transmission. Non-blocking: returns false if the
// radio TX channel is full (e.g. still joining or backlogged).
func (t *LoRaWANTransport) Send(p transport.Packet) bool {
	tx := radio.TxMsg{
		Port:      p.Port,
		Confirmed: t.confirmed,
		Len:       p.Len,
	}
	copy(tx.Payload[:], p.Payload[:p.Len])
	select {
	case t.rad.TxChan <- tx:
		return true
	default:
		return false
	}
}

// RecvChan returns the channel for incoming downlink packets.
func (t *LoRaWANTransport) RecvChan() <-chan transport.Packet {
	return t.rxChan
}

// IsReady reports whether the radio has completed OTAA join.
func (t *LoRaWANTransport) IsReady() bool {
	return t.rad.IsJoined()
}

// bridgeRx copies radio.RxMsg values from the radio channel into the shared Packet channel.
func (t *LoRaWANTransport) bridgeRx() {
	for rx := range t.rad.RxChan {
		p := transport.Packet{Port: rx.Port, Len: rx.Len}
		copy(p.Payload[:], rx.Payload[:rx.Len])
		select {
		case t.rxChan <- p:
		default:
			println("[lorawan] rx chan full, dropping")
		}
	}
}
