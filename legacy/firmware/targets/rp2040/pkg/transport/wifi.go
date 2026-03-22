//go:build rp2040

// Package transport provides the WiFi HTTP implementation of transport.Transport.
// The RP2040 (Pico W) posts telemetry to the backend /api/farmon/ingest endpoint
// and reads pending commands from the response body.
//
// Uses soypat/cyw43439 driver for the Pico W's onboard CYW43439 WiFi chip.
package transport

import (
	"encoding/hex"
	"machine"
	"net/netip"
	"time"

	"github.com/kisinga/farmon/firmware/pkg/transport"
	"github.com/soypat/cyw43439"
	"github.com/soypat/cyw43439/examples/cywnet"
	"github.com/soypat/lneto/http/httpraw"
	"github.com/soypat/lneto/tcp"
)

// WiFiSettings holds WiFi and backend connection credentials.
// Stored in flash immediately after the CoreSettings block.
type WiFiSettings struct {
	SSID        [32]byte
	Password    [64]byte
	BackendHost [64]byte  // e.g. "192.168.1.10"
	BackendPort [8]byte   // e.g. "8090"
	BackendPath [64]byte  // e.g. "/api/farmon/ingest"
	DeviceToken [64]byte  // Bearer token for Authorization header
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

// WiFiTransport implements transport.Transport via raw TCP HTTP POST.
type WiFiTransport struct {
	stack     *cywnet.Stack
	settings  WiFiSettings
	txChan    chan transport.Packet
	rxBuf     [8]transport.Packet
	rxHead    uint8
	rxCount   uint8
	connected bool
}

// Compile-time interface check.
var _ transport.Transport = (*WiFiTransport)(nil)

// New creates a WiFiTransport. Call after WiFi is connected and DHCP is done.
func New(stack *cywnet.Stack, wifiSettings WiFiSettings) *WiFiTransport {
	t := &WiFiTransport{
		stack:     stack,
		settings:  wifiSettings,
		txChan:    make(chan transport.Packet, 4),
		connected: true,
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

// Recv returns the next buffered downlink packet, or false if none.
func (t *WiFiTransport) Recv() (transport.Packet, bool) {
	if t.rxCount == 0 {
		return transport.Packet{}, false
	}
	p := t.rxBuf[t.rxHead]
	t.rxHead = (t.rxHead + 1) % uint8(len(t.rxBuf))
	t.rxCount--
	return p, true
}

// IsReady reports whether the WiFi is connected and backend is reachable.
func (t *WiFiTransport) IsReady() bool {
	return t.connected
}

const tcpBufSize = 2030

// run is the main transport goroutine — services the TX channel.
func (t *WiFiTransport) run() {
	for {
		p := <-t.txChan

		cmds, err := t.post(p)
		if err != nil {
			println("[wifi] POST failed:", err.Error())
			continue
		}

		for _, cmd := range cmds {
			if t.rxCount < uint8(len(t.rxBuf)) {
				idx := (t.rxHead + t.rxCount) % uint8(len(t.rxBuf))
				t.rxBuf[idx] = cmd
				t.rxCount++
			} else {
				println("[wifi] rx buf full, dropping command")
			}
		}
	}
}

// post sends a single packet to the backend via raw TCP HTTP POST.
func (t *WiFiTransport) post(p transport.Packet) ([]transport.Packet, error) {
	payloadHex := hex.EncodeToString(p.Payload[:p.Len])
	var jsonBuf [512]byte
	jsonLen := buildJSON(jsonBuf[:], p.Port, payloadHex)

	// Parse server address
	addrPort, err := netip.ParseAddrPort(t.settings.HostStr() + ":" + t.settings.PortStr())
	if err != nil {
		return nil, err
	}

	// Build HTTP request
	var hdr httpraw.Header
	hdr.SetMethod("POST")
	hdr.SetRequestURI(t.settings.PathStr())
	hdr.SetProtocol("HTTP/1.1")
	hdr.Set("Host", t.settings.HostStr())
	hdr.Set("Content-Type", "application/json")
	hdr.Set("Authorization", "Bearer "+t.settings.TokenStr())
	hdr.Set("Connection", "close")
	hdr.Set("Content-Length", itoa(jsonLen))

	reqBytes, err := hdr.AppendRequest(nil)
	if err != nil {
		return nil, err
	}
	// Append JSON body
	reqBytes = append(reqBytes, jsonBuf[:jsonLen]...)

	// Open TCP connection
	stack := t.stack.LnetoStack()
	const pollTime = 5 * time.Millisecond
	rstack := stack.StackRetrying(pollTime)

	var conn tcp.Conn
	err = conn.Configure(tcp.ConnConfig{
		RxBuf:             make([]byte, tcpBufSize),
		TxBuf:             make([]byte, tcpBufSize),
		TxPacketQueueSize: 3,
	})
	if err != nil {
		return nil, err
	}

	lport := uint16(stack.Prand32()>>17) + 1024
	err = rstack.DoDialTCP(&conn, lport, addrPort, 5*time.Second, 3)
	if err != nil {
		conn.Abort()
		return nil, err
	}

	// Send request
	_, err = conn.Write(reqBytes)
	if err != nil {
		conn.Close()
		return nil, err
	}

	// Read response
	time.Sleep(500 * time.Millisecond)
	var rxBuf [2048]byte
	n, _ := conn.Read(rxBuf[:])
	conn.Close()
	for i := 0; i < 20 && !conn.State().IsClosed(); i++ {
		time.Sleep(50 * time.Millisecond)
	}
	conn.Abort()

	if n == 0 {
		return nil, nil
	}

	// Find body (after \r\n\r\n)
	body := rxBuf[:n]
	for i := 0; i < n-3; i++ {
		if body[i] == '\r' && body[i+1] == '\n' && body[i+2] == '\r' && body[i+3] == '\n' {
			body = body[i+4:]
			break
		}
	}

	return parseCommands(body), nil
}

// buildJSON constructs {"fport":N,"payload":"HEX"} into buf, returns byte count.
func buildJSON(buf []byte, fport uint8, payloadHex string) int {
	const prefix = `{"fport":`
	n := copy(buf, prefix)
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

func itoa(n int) string {
	if n == 0 {
		return "0"
	}
	var buf [10]byte
	i := len(buf)
	for n > 0 {
		i--
		buf[i] = byte('0' + n%10)
		n /= 10
	}
	return string(buf[i:])
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

// parseCommands extracts command packets from the response body bytes.
func parseCommands(data []byte) []transport.Packet {
	if len(data) == 0 {
		return nil
	}

	start := findSubstring(data, `"commands":[`)
	if start < 0 {
		return nil
	}
	start += len(`"commands":[`)

	var cmds []transport.Packet
	for {
		objStart := findSubstring(data[start:], `{"fport":`)
		if objStart < 0 {
			break
		}
		objStart += start

		fportStart := objStart + len(`{"fport":`)
		fport := parseUint8(data, fportStart)

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

// SetupWiFi initializes the CYW43439, connects to WiFi, and runs DHCP.
// Returns the stack for use with New().
func SetupWiFi(ssid, password string) (*cywnet.Stack, error) {
	devcfg := cyw43439.DefaultWifiConfig()
	stack, err := cywnet.NewConfiguredPicoWithStack(ssid, password, devcfg, cywnet.StackConfig{
		Hostname:    "farmon-node",
		MaxTCPPorts: 2,
	})
	if err != nil {
		return nil, err
	}

	go func() {
		for {
			send, recv, _ := stack.RecvAndSend()
			if send == 0 && recv == 0 {
				time.Sleep(5 * time.Millisecond)
			}
		}
	}()

	_, err = stack.SetupWithDHCP(cywnet.DHCPConfig{})
	if err != nil {
		return nil, err
	}

	return stack, nil
}

// keep machine import used
var _ = machine.GPIO0
