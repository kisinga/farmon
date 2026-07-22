package metering

import (
	"fmt"
	"time"

	"github.com/fxamacker/cbor/v2"
)

// LwM2M-style object model (spec §3.2). Each CBOR payload is an array of
// maps; every map carries a "bn" (base name) plus integer keys. Semantics of
// keys marked "unverified" in the spec are NOT trusted — the raw CBOR is
// always persisted alongside whatever we parse.
const (
	BnDevice    = "/3/0"  // device info
	BnMeter     = "/80/0" // meter reading
	BnValve     = "/81/0" // valve state / control
	BnReporting = "/84/0" // reporting config
	BnNetwork   = "/99/0" // network / signal
	BnCmdTail   = "/70/0" // fixed command trailer constant
)

// /3/0 keys.
const (
	KeySN          = 2  // serial number (string)
	KeyICCID       = 1  // unverified
	KeyUnixTS      = 13 // device clock, unix seconds
	KeyTimezone    = 14 // e.g. "UTC+8"
	KeyProtoVer    = 18 // protocol version (string)
	KeyFirmwareVer = 19 // firmware version (string)
	KeyTimeCalib   = 25 // present (=1) in time-calibration frames
)

// /80/0 keys.
const (
	KeyModel      = 0  // model string, e.g. "LXC-20"
	KeyPN         = 2  // litres per pulse
	KeyMaxReading = 7  // rollover limit
	KeyCumulative = 16 // cumulative reading, litres
	KeyReadingTS  = 21 // reading timestamp, unix seconds
)

// /81/0 keys.
const (
	KeyValveCmd   = 0 // downlink: 1=close, 0=open (per fixtures — counterintuitive, verify on live unit)
	KeyValvePos1  = 1 // position detect, semantics unverified
	KeyValvePos2  = 2 // position detect, semantics unverified
	KeyValveState = 3 // uplink state: 1 seen on an open valve; verify against live unit
)

// /84/0 keys.
const (
	KeyReportInterval = 0 // reporting interval, seconds (86400 default)
)

// /99/0 keys.
const (
	KeyIMEI = 1 // string
	// 11/13/14: signal metrics (rsrp/snr), semantics unverified — stored raw.
)

// cmdTrailerValue is the fixed {2: 2018, bn: "/70/0"} trailer the vendor
// appends to every downlink command (spec §3.3).
const cmdTrailerValue = 2018

// Object is one decoded CBOR map: integer keys plus the "bn" text key.
type Object map[any]any

// Objects is a decoded payload data domain.
type Objects []Object

// cborMode pins canonical (length-first sorted) map encoding so Build output
// is deterministic and byte-identical to the vendor's own frames.
var cborMode = func() cbor.EncMode {
	m, err := cbor.CanonicalEncOptions().EncMode()
	if err != nil {
		panic(err)
	}
	return m
}()

// DecodeObjects parses the CBOR data domain of a frame.
func DecodeObjects(payload []byte) (Objects, error) {
	var objs Objects
	if err := cbor.Unmarshal(payload, &objs); err != nil {
		return nil, fmt.Errorf("metering: CBOR decode: %w", err)
	}
	return objs, nil
}

// Encode serializes the objects back to CBOR (canonical, deterministic).
func (o Objects) Encode() ([]byte, error) {
	return cborMode.Marshal(o)
}

// Find returns the first object with the given base name, or nil.
func (o Objects) Find(bn string) Object {
	for _, m := range o {
		if s, ok := m["bn"].(string); ok && s == bn {
			return m
		}
	}
	return nil
}

// str reads a string value for an integer key.
func (m Object) str(key int) string {
	if v, ok := m[uint64(key)].(string); ok {
		return v
	}
	return ""
}

// num reads a numeric value for an integer key (CBOR ints decode to uint64).
func (m Object) num(key int) (uint64, bool) {
	switch v := m[uint64(key)].(type) {
	case uint64:
		return v, true
	case int64:
		if v >= 0 {
			return uint64(v), true
		}
	}
	return 0, false
}

// SN returns the device serial number from /3/0.
func (o Objects) SN() string {
	if m := o.Find(BnDevice); m != nil {
		return m.str(KeySN)
	}
	return ""
}

// IMEI returns the modem IMEI from /99/0.
func (o Objects) IMEI() string {
	if m := o.Find(BnNetwork); m != nil {
		return m.str(KeyIMEI)
	}
	return ""
}

// Reading extracts the cumulative reading (litres) and its device timestamp
// from /80/0. ok is false when either is absent.
func (o Objects) Reading() (litres uint64, ts time.Time, ok bool) {
	m := o.Find(BnMeter)
	if m == nil {
		return 0, time.Time{}, false
	}
	l, okL := m.num(KeyCumulative)
	t, okT := m.num(KeyReadingTS)
	if !okL || !okT {
		return 0, time.Time{}, false
	}
	return l, time.Unix(int64(t), 0).UTC(), true
}

// ValveState extracts the reported valve state from /81/0. The integer
// semantics are unverified (1 seen on an open valve) — callers should persist
// it raw and only map it to open/closed after live-device validation.
func (o Objects) ValveState() (state uint64, ok bool) {
	if m := o.Find(BnValve); m != nil {
		return m.num(KeyValveState)
	}
	return 0, false
}

// Model returns the meter model string from /80/0.
func (o Objects) Model() string {
	if m := o.Find(BnMeter); m != nil {
		return m.str(KeyModel)
	}
	return ""
}

// BuildTimeCalibFrame builds the immediate time-calibration reply (spec §3.3
// step 2). The SN must echo the device's own serial or it ignores the packet.
func BuildTimeCalibFrame(id uint16, sn string, now time.Time, tz string) Frame {
	payload, err := (Objects{{
		uint64(KeySN):        sn,
		uint64(KeyUnixTS):    uint64(now.Unix()),
		uint64(KeyTimezone):  tz,
		uint64(KeyTimeCalib): uint64(1),
		"bn":                 BnDevice,
	}}).Encode()
	if err != nil {
		panic(err) // static shape — cannot fail
	}
	return Frame{Type: TypeResponse, Func: FuncTimeCalib, ID: id, Payload: payload}
}

// BuildValveFrame builds a valve open/close command (spec §3.3 step 3).
// Per the vendor fixtures: KeyValveCmd 1 = CLOSE, 0 = OPEN (counterintuitive;
// flagged for live-unit validation in spec §9).
func BuildValveFrame(id uint16, imei string, close bool) Frame {
	var cmd uint64
	if close {
		cmd = 1
	}
	payload, err := (Objects{
		{
			uint64(KeyValveCmd): cmd,
			uint64(22):          imei,
			"bn":                BnValve,
		},
		{
			uint64(KeySN): uint64(cmdTrailerValue),
			"bn":          BnCmdTail,
		},
	}).Encode()
	if err != nil {
		panic(err) // static shape — cannot fail
	}
	return Frame{Type: TypeUplink, Func: FuncControl, ID: id, Payload: payload}
}

// BuildSetIntervalFrame builds a reporting-interval command (/84/0 key 0).
func BuildSetIntervalFrame(id uint16, imei string, seconds uint64) Frame {
	payload, err := (Objects{
		{
			uint64(KeyReportInterval): seconds,
			uint64(22):                imei,
			"bn":                      BnReporting,
		},
		{
			uint64(KeySN): uint64(cmdTrailerValue),
			"bn":          BnCmdTail,
		},
	}).Encode()
	if err != nil {
		panic(err) // static shape — cannot fail
	}
	return Frame{Type: TypeUplink, Func: FuncControl, ID: id, Payload: payload}
}
