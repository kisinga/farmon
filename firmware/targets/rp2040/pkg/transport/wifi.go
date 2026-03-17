//go:build rp2040

// Package transport provides the WiFi HTTP implementation of transport.Transport.
// The RP2040 (Pico W) posts telemetry to the backend /api/farmon/ingest endpoint
// and reads pending commands from the response body.
//
// The wire protocol is identical to LoRaWAN — the backend already speaks the
// same fPort-based binary format over HTTP, so no re-encoding is needed.
package transport

import (
	"encoding/binary"
	"encoding/hex"
	"machine"
	"time"

	"github.com/farm/firmware/pkg/transport"
	"tinygo.org/x/drivers/net/http"
	"tinygo.org/x/drivers/wifinina"
)

// WiFiSettings holds WiFi and backend connection credentials.
// Stored in flash immediately after the CoreSettings block.
type WiFiSettings struct {
	SSID        [32]byte
	Password    [64]byte
	BackendURL  [128]byte // e.g. "http://192.168.1.10:8090/api/farmon/ingest"
	DeviceToken [64]byte  // Bearer token for Authorization header
}

// ssidStr returns SSID as a null-terminated string.
func (w *WiFiSettings) ssidStr() string {
	for i, b := range w.SSID {
		if b == 0 {
			return string(w.SSID[:i])
		}
	}
	return string(w.SSID[:])
}

// passwordStr returns Password as a null-terminated string.
func (w *WiFiSettings) passwordStr() string {
	for i, b := range w.Password {
		if b == 0 {
			return string(w.Password[:i])
		}
	}
	return string(w.Password[:])
}

// backendURLStr returns BackendURL as a null-terminated string.
func (w *WiFiSettings) backendURLStr() string {
	for i, b := range w.BackendURL {
		if b == 0 {
			return string(w.BackendURL[:i])
		}
	}
	return string(w.BackendURL[:])
}

// tokenStr returns DeviceToken as a null-terminated string.
func (w *WiFiSettings) tokenStr() string {
	for i, b := range w.DeviceToken {
		if b == 0 {
			return string(w.DeviceToken[:i])
		}
	}
	return string(w.DeviceToken[:])
}

// WiFiTransport implements transport.Transport via HTTP POST.
type WiFiTransport struct {
	wifi      *wifinina.Device
	settings  WiFiSettings
	txChan    chan transport.Packet
	rxChan    chan transport.Packet
	connected bool
}

// Compile-time interface check.
var _ transport.Transport = (*WiFiTransport)(nil)

// New creates a WiFiTransport and starts the background WiFi goroutine.
// spi and cs/ack/rst/gpio0 are the SPI bus and control pins for the WiFi chip.
func New(wifi *wifinina.Device, wifiSettings WiFiSettings) *WiFiTransport {
	t := &WiFiTransport{
		wifi:     wifi,
		settings: wifiSettings,
		txChan:   make(chan transport.Packet, 4),
		rxChan:   make(chan transport.Packet, 4),
	}
	go t.run()
	return t
}

// Send enqueues a packet for transmission. Non-blocking: drops if buffer full.
func (t *WiFiTransport) Send(p transport.Packet) bool {
	select {
	case t.txChan <- p:
		return true
	default:
		println("[wifi] tx chan full, dropping")
		return false
	}
}

// RecvChan returns the channel for incoming command packets.
func (t *WiFiTransport) RecvChan() <-chan transport.Packet {
	return t.rxChan
}

// IsReady reports whether the WiFi is connected and backend is reachable.
func (t *WiFiTransport) IsReady() bool {
	return t.connected
}

// run is the main WiFi goroutine.
func (t *WiFiTransport) run() {
	backoff := 10 * time.Second

	for {
		// Connect to WiFi
		println("[wifi] connecting to", t.settings.ssidStr())
		err := t.wifi.Connect(t.settings.ssidStr(), t.settings.passwordStr(),
			wifinina.SecurityWPA2Personal)
		if err != nil {
			println("[wifi] connect failed:", err.Error(), "- retry in", backoff/time.Second, "s")
			time.Sleep(backoff)
			if backoff < 120*time.Second {
				backoff *= 2
			}
			continue
		}
		t.connected = true
		backoff = 10 * time.Second
		println("[wifi] connected")

		// Service TX channel
		for {
			p := <-t.txChan

			cmds, err := t.post(p)
			if err != nil {
				println("[wifi] POST failed:", err.Error())
				t.connected = false
				break // re-enter outer connect loop
			}

			// Forward received commands to rxChan
			for _, cmd := range cmds {
				select {
				case t.rxChan <- cmd:
				default:
					println("[wifi] rx chan full, dropping command")
				}
			}
		}
	}
}

// post sends a single packet to the backend and returns any pending commands.
func (t *WiFiTransport) post(p transport.Packet) ([]transport.Packet, error) {
	// Build minimal JSON body:
	// {"fport": N, "payload": "hex..."}
	payloadHex := hex.EncodeToString(p.Payload[:p.Len])
	// Fixed-size stack buffer for the JSON body (avoids heap alloc in hot path)
	var body [512]byte
	n := buildJSON(body[:], p.Port, payloadHex)

	req, err := http.NewRequest("POST", t.settings.backendURLStr(), body[:n])
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+t.settings.tokenStr())

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != 200 {
		println("[wifi] backend returned", resp.StatusCode)
		return nil, nil
	}

	return parseCommands(resp.Body), nil
}

// buildJSON constructs {"fport":N,"payload":"HEX"} into buf, returns byte count.
// No standard library JSON — hand-built to avoid allocations.
func buildJSON(buf []byte, fport uint8, payloadHex string) int {
	const prefix = `{"fport":`
	n := copy(buf, prefix)
	// Write fport as decimal (0-255 fits in 3 chars)
	n += writeUint8Decimal(buf[n:], fport)
	buf[n] = ','
	n++
	n += copy(buf[n:], `"payload":"`)
	n += copy(buf[n:], payloadHex)
	buf[n] = '"'
	n++
	buf[n] = '}'
	n++
	return n
}

func writeUint8Decimal(buf []byte, v uint8) int {
	if v >= 100 {
		buf[0] = '0' + v/100
		buf[1] = '0' + (v/10)%10
		buf[2] = '0' + v%10
		return 3
	}
	if v >= 10 {
		buf[0] = '0' + v/10
		buf[1] = '0' + v%10
		return 2
	}
	buf[0] = '0' + v
	return 1
}

// parseCommands reads the backend response body and extracts pending command packets.
// Expected format: {"ok":true,"commands":[{"fport":N,"payload":"HEX"},...]}
// Minimal hand-parsed JSON (no reflection, no allocations beyond the packet slice).
func parseCommands(body interface{ Read([]byte) (int, error) }) []transport.Packet {
	var buf [1024]byte
	n, _ := body.Read(buf[:])
	if n == 0 {
		return nil
	}

	// Find "commands":[...] array
	data := buf[:n]
	start := findSubstring(data, `"commands":[`)
	if start < 0 {
		return nil
	}
	start += len(`"commands":[`)

	var cmds []transport.Packet
	for {
		// Find next {"fport": object
		objStart := findSubstring(data[start:], `{"fport":`)
		if objStart < 0 {
			break
		}
		objStart += start

		// Extract fport value
		fportStart := objStart + len(`{"fport":`)
		fport := parseUint8(data, fportStart)

		// Extract payload hex string
		payloadMarker := findSubstring(data[objStart:], `"payload":"`)
		if payloadMarker < 0 {
			break
		}
		payloadStart := objStart + payloadMarker + len(`"payload":"`)
		payloadEnd := findByte(data[payloadStart:], '"')
		if payloadEnd < 0 {
			break
		}

		hexStr := data[payloadStart : payloadStart+payloadEnd]
		decoded, err := hex.DecodeString(string(hexStr))
		if err == nil && len(decoded) <= transport.MaxPayload {
			var p transport.Packet
			p.Port = fport
			p.Len = uint8(len(decoded))
			copy(p.Payload[:], decoded)
			cmds = append(cmds, p)
		}

		start = payloadStart + payloadEnd + 1
		if start >= len(data) {
			break
		}
	}
	return cmds
}

func findSubstring(data []byte, needle string) int {
	nb := []byte(needle)
	for i := 0; i <= len(data)-len(nb); i++ {
		match := true
		for j := range nb {
			if data[i+j] != nb[j] {
				match = false
				break
			}
		}
		if match {
			return i
		}
	}
	return -1
}

func findByte(data []byte, b byte) int {
	for i, v := range data {
		if v == b {
			return i
		}
	}
	return -1
}

func parseUint8(data []byte, start int) uint8 {
	v := uint16(0)
	for i := start; i < len(data) && data[i] >= '0' && data[i] <= '9'; i++ {
		v = v*10 + uint16(data[i]-'0')
	}
	return uint8(v)
}

// WiFiSettingsSize is the flash block size for WiFiSettings serialization.
const WiFiSettingsSize = 288 // 32+64+128+64

// EncodeWiFiSettings serializes WiFiSettings to a fixed-size byte slice.
func EncodeWiFiSettings(w WiFiSettings) []byte {
	buf := make([]byte, WiFiSettingsSize)
	copy(buf[0:32], w.SSID[:])
	copy(buf[32:96], w.Password[:])
	copy(buf[96:224], w.BackendURL[:])
	copy(buf[224:288], w.DeviceToken[:])
	return buf
}

// DecodeWiFiSettings deserializes WiFiSettings from a byte slice.
func DecodeWiFiSettings(buf []byte) WiFiSettings {
	if len(buf) < WiFiSettingsSize {
		return WiFiSettings{}
	}
	var w WiFiSettings
	copy(w.SSID[:], buf[0:32])
	copy(w.Password[:], buf[32:96])
	copy(w.BackendURL[:], buf[96:224])
	copy(w.DeviceToken[:], buf[224:288])
	return w
}

// keep machine import used (RP2040 GPIO for WiFi chip select)
var _ = machine.GPIO0
var _ = binary.LittleEndian
