//go:build esp32s3

// Package transport provides a WiFi HTTP transport for the ESP32-S3.
// This is a stub that mirrors the RP2040 transport interface.
// TODO: Implement using ESP32 native WiFi (net package with espat or native stack).
package transport

import (
	"github.com/kisinga/farmon/firmware/pkg/transport"
)

// WiFiSettings holds WiFi and backend connection credentials.
type WiFiSettings struct {
	SSID        [32]byte
	Password    [64]byte
	BackendHost [64]byte
	BackendPort [8]byte
	BackendPath [64]byte
	DeviceToken [64]byte
}

func nullStr(b []byte) string {
	for i, v := range b {
		if v == 0 {
			return string(b[:i])
		}
	}
	return string(b)
}

func (w *WiFiSettings) SSIDStr() string     { return nullStr(w.SSID[:]) }
func (w *WiFiSettings) PasswordStr() string { return nullStr(w.Password[:]) }
func (w *WiFiSettings) HostStr() string     { return nullStr(w.BackendHost[:]) }
func (w *WiFiSettings) PortStr() string     { return nullStr(w.BackendPort[:]) }
func (w *WiFiSettings) PathStr() string     { return nullStr(w.BackendPath[:]) }
func (w *WiFiSettings) TokenStr() string    { return nullStr(w.DeviceToken[:]) }

// WiFiSettingsSize is the flash block size for WiFiSettings serialization.
const WiFiSettingsSize = 296 // 32+64+64+8+64+64

// EncodeWiFiSettings serializes WiFiSettings to a fixed-size byte slice.
func EncodeWiFiSettings(w WiFiSettings) []byte {
	buf := make([]byte, WiFiSettingsSize)
	off := 0
	off += copy(buf[off:], w.SSID[:])
	off += copy(buf[off:], w.Password[:])
	off += copy(buf[off:], w.BackendHost[:])
	off += copy(buf[off:], w.BackendPort[:])
	off += copy(buf[off:], w.BackendPath[:])
	copy(buf[off:], w.DeviceToken[:])
	return buf
}

// DecodeWiFiSettings deserializes WiFiSettings from a byte slice.
func DecodeWiFiSettings(buf []byte) WiFiSettings {
	if len(buf) < WiFiSettingsSize {
		return WiFiSettings{}
	}
	var w WiFiSettings
	off := 0
	copy(w.SSID[:], buf[off:off+32]); off += 32
	copy(w.Password[:], buf[off:off+64]); off += 64
	copy(w.BackendHost[:], buf[off:off+64]); off += 64
	copy(w.BackendPort[:], buf[off:off+8]); off += 8
	copy(w.BackendPath[:], buf[off:off+64]); off += 64
	copy(w.DeviceToken[:], buf[off:off+64])
	return w
}

// ESP32S3WiFiTransport implements transport.Transport via WiFi HTTP POST.
// TODO: Replace stub with actual ESP32-S3 WiFi implementation.
type ESP32S3WiFiTransport struct {
	settings  WiFiSettings
	txChan    chan transport.Packet
	rxBuf     [8]transport.Packet
	rxHead    uint8
	rxCount   uint8
	connected bool
}

var _ transport.Transport = (*ESP32S3WiFiTransport)(nil)

func (t *ESP32S3WiFiTransport) Send(p transport.Packet) bool {
	select {
	case t.txChan <- p:
		return true
	default:
		println("[wifi] tx chan full, dropping")
		return false
	}
}

func (t *ESP32S3WiFiTransport) Recv() (transport.Packet, bool) {
	if t.rxCount == 0 {
		return transport.Packet{}, false
	}
	p := t.rxBuf[t.rxHead]
	t.rxHead = (t.rxHead + 1) % uint8(len(t.rxBuf))
	t.rxCount--
	return p, true
}

func (t *ESP32S3WiFiTransport) IsReady() bool {
	return t.connected
}

// SetupAndConnect initializes WiFi and returns a transport.
// TODO: Implement ESP32-S3 native WiFi connection.
func SetupAndConnect(ws WiFiSettings) (*ESP32S3WiFiTransport, error) {
	t := &ESP32S3WiFiTransport{
		settings:  ws,
		txChan:    make(chan transport.Packet, 4),
		connected: true, // stub: assume connected
	}
	go t.run()
	return t, nil
}

func (t *ESP32S3WiFiTransport) run() {
	for {
		p := <-t.txChan
		// TODO: POST p to backend
		_ = p
		println("[wifi] TODO: POST telemetry (stub)")
	}
}
