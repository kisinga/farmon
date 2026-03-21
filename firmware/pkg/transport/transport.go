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
//   - Send transmits an uplink packet. On LoRaWAN it blocks through
//     the TX/RX cycle and buffers any downlink received. On WiFi it
//     POSTs to the backend and buffers response commands.
//   - Recv returns the next buffered downlink packet, or false if none.
//     It is non-blocking and safe to call in a tight loop.
//   - IsReady reports whether the transport has a live connection to the
//     backend (joined for LoRaWAN, associated+reachable for WiFi).
type Transport interface {
	Send(p Packet) bool
	Recv() (Packet, bool)
	IsReady() bool
}
