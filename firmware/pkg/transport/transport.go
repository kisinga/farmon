// Package transport defines the unified messaging contract between the sensor
// node and the backend, independent of the physical medium (LoRaWAN, WiFi, etc.).
//
// The fPort namespace from the LoRaWAN protocol package is reused as the command
// namespace on all transports — the backend already speaks the same fPort protocol
// over HTTP, so both targets are wire-compatible with the same backend.
package transport

// MaxPayload is the largest payload either transport can carry.
// Capped at LoRaWAN DR3 US915 limit (222 bytes) so telemetry encoded for
// LoRaWAN is also valid over WiFi without a re-encode step.
const MaxPayload = 222

// Packet is a single framed message — uplink or downlink.
type Packet struct {
	Port    uint8
	Payload [MaxPayload]byte
	Len     uint8
}

// Transport is the interface both LoRaWAN and WiFi implement.
//
// Contract:
//   - Send is non-blocking: returns false and drops the packet if the
//     outbound buffer is full (e.g. transport is reconnecting). The sensor
//     loop must not stall waiting for the transport.
//   - RecvChan returns a read-only channel that receives downlink/command
//     packets. The caller ranges over this channel in the main goroutine.
//   - IsReady reports whether the transport has a live connection to the
//     backend (joined for LoRaWAN, associated+reachable for WiFi).
//   - All methods are safe to call from any goroutine.
type Transport interface {
	Send(p Packet) bool
	RecvChan() <-chan Packet
	IsReady() bool
}
