package metering

import (
	"bytes"
	"encoding/hex"
	"math/rand"
	"testing"
	"time"
)

func mustHex(t *testing.T, s string) []byte {
	t.Helper()
	b, err := hex.DecodeString(s)
	if err != nil {
		t.Fatalf("bad fixture hex: %v", err)
	}
	return b
}

// Every vendor fixture must parse and re-serialize byte-identically. This also
// locks the CRC16 variant (AUG-CCITT, big-endian, full frame minus CRC) that
// the probe test determined — a silent CRC change breaks every assertion here.
func TestFixturesRoundTrip(t *testing.T) {
	for i, fx := range fixtureFrames {
		raw := mustHex(t, fx)
		f, err := ParseFrame(raw)
		if err != nil {
			t.Fatalf("fixture %d: parse: %v", i, err)
		}
		if got := f.Build(); !bytes.Equal(got, raw) {
			t.Fatalf("fixture %d: round-trip mismatch:\n got %x\nwant %x", i, got, raw)
		}
	}
}

func TestFixtureDecodes(t *testing.T) {
	// Uplink: device info + meter + valve + reporting + network.
	f, err := ParseFrame(mustHex(t, fixtureFrames[0]))
	if err != nil {
		t.Fatal(err)
	}
	if f.Type != TypeUplink || f.Func != FuncUplink || f.ID != 0xcfbd {
		t.Fatalf("uplink header: type=%02x func=%02x id=%04x", f.Type, f.Func, f.ID)
	}
	objs, err := DecodeObjects(f.Payload)
	if err != nil {
		t.Fatal(err)
	}
	if sn := objs.SN(); sn != "123456789" {
		t.Errorf("SN = %q, want 123456789", sn)
	}
	if imei := objs.IMEI(); imei != "867724031768408" {
		t.Errorf("IMEI = %q, want 867724031768408", imei)
	}
	if model := objs.Model(); model != "LXC-20" {
		t.Errorf("Model = %q, want LXC-20", model)
	}
	litres, ts, ok := objs.Reading()
	if !ok {
		t.Fatal("no reading in uplink fixture")
	}
	if litres != 9999999 {
		t.Errorf("cumulative = %d L, want 9999999", litres)
	}
	if ts.Unix() != 0x64351eb7 {
		t.Errorf("reading ts = %d, want %d", ts.Unix(), 0x64351eb7)
	}
	vs, ok := objs.ValveState()
	if !ok || vs != 1 {
		t.Errorf("valve state = %d, %v; want 1, true", vs, ok)
	}
	if m := objs.Find(BnReporting); m != nil {
		if iv, ok := m.num(KeyReportInterval); !ok || iv != 86400 {
			t.Errorf("report interval = %d, %v; want 86400, true", iv, ok)
		}
	} else {
		t.Error("missing /84/0 reporting object")
	}

	// Command result echoes the /70/0 trailer value.
	f, err = ParseFrame(mustHex(t, fixtureFrames[4]))
	if err != nil {
		t.Fatal(err)
	}
	if f.Type != TypeResponse || f.Func != FuncCmdResult {
		t.Fatalf("result header: type=%02x func=%02x", f.Type, f.Func)
	}
	objs, err = DecodeObjects(f.Payload)
	if err != nil {
		t.Fatal(err)
	}
	if m := objs.Find(BnCmdTail); m != nil {
		if v, ok := m.num(KeySN); !ok || v != cmdTrailerValue {
			t.Errorf("trailer = %d, %v; want %d, true", v, ok, cmdTrailerValue)
		}
	} else {
		t.Error("missing /70/0 trailer in command result")
	}
}

// Builders must reproduce the vendor's own downlink frames byte-for-byte when
// given the same message IDs — this pins both the CBOR encoding order and the
// CRC on frames WE generate.
func TestBuildersMatchFixtures(t *testing.T) {
	// Time-calibration (fixture 1). Timestamp 0x6965eb8e, tz "UTC+8".
	f := BuildTimeCalibFrame(0xfb6e, "123456789", time.Unix(0x6965eb8e, 0).UTC(), "UTC+8")
	if got, want := f.Build(), mustHex(t, fixtureFrames[1]); !bytes.Equal(got, want) {
		t.Errorf("time-calib build:\n got %x\nwant %x", got, want)
	}

	// Close valve (fixture 2).
	f = BuildValveFrame(0x51d5, "867724031768408", true)
	if got, want := f.Build(), mustHex(t, fixtureFrames[2]); !bytes.Equal(got, want) {
		t.Errorf("close-valve build:\n got %x\nwant %x", got, want)
	}

	// Open valve (fixture 3).
	f = BuildValveFrame(0xc4a2, "867724031768408", false)
	if got, want := f.Build(), mustHex(t, fixtureFrames[3]); !bytes.Equal(got, want) {
		t.Errorf("open-valve build:\n got %x\nwant %x", got, want)
	}

	// Close-valve CBOR decodes to the documented shape (spec §3.4).
	objs, err := DecodeObjects(BuildValveFrame(1, "867724031768408", true).Payload)
	if err != nil {
		t.Fatal(err)
	}
	if m := objs.Find(BnValve); m == nil {
		t.Fatal("no /81/0 object")
	} else {
		if v, _ := m.num(KeyValveCmd); v != 1 {
			t.Errorf("close cmd value = %d, want 1", v)
		}
		if imei := m.str(22); imei != "867724031768408" {
			t.Errorf("cmd imei = %q", imei)
		}
	}
}

func TestMalformedFrames(t *testing.T) {
	valid := mustHex(t, fixtureFrames[2])
	cases := map[string][]byte{
		"empty":         {},
		"short":         valid[:8],
		"oversized":     make([]byte, maxFrameSize+1),
		"bad header":    append([]byte{0x02, 0x02}, valid[2:]...),
		"bad format":    append(append([]byte{}, valid[:6]...), append([]byte{0x99}, valid[7:]...)...),
		"bad delimiter": append(append([]byte{}, valid[:9]...), append([]byte{0x00}, valid[10:]...)...),
		"truncated":     valid[:len(valid)-3],
		"id zero": func() []byte {
			b := append([]byte{}, valid...)
			b[4], b[5] = 0, 0
			// fix CRC so only the ID check can fire
			b = Frame{Type: b[2], Func: b[3], ID: 0, Payload: b[10 : len(b)-2]}.Build()
			return b
		}(),
	}
	// Corrupt one payload byte → CRC must reject.
	corrupt := append([]byte{}, valid...)
	corrupt[15] ^= 0xff
	cases["bad crc"] = corrupt

	for name, pkt := range cases {
		if _, err := ParseFrame(pkt); err == nil {
			t.Errorf("%s: expected error, got none", name)
		}
	}
}

// Fuzz: random garbage must never panic — only typed errors or (astronomically
// rare) a valid parse.
func TestFuzzNoPanic(t *testing.T) {
	rng := rand.New(rand.NewSource(42))
	for i := 0; i < 10000; i++ {
		n := rng.Intn(300)
		pkt := make([]byte, n)
		rng.Read(pkt)
		// Bias some packets toward looking real: valid header + format byte.
		if n >= 10 && i%3 == 0 {
			pkt[0], pkt[1], pkt[6], pkt[9] = 0x01, 0x01, formatCBOR, delimiter
		}
		_, _ = ParseFrame(pkt) // must not panic
	}
}
