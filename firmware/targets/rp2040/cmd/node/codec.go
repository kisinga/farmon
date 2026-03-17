package main

import (
	"encoding/binary"

	"github.com/farm/firmware/pkg/settings"
	rp2040transport "github.com/farm/firmware/targets/rp2040/pkg/transport"
)

// Binary codec for RP2040 flash storage.
//
// Flash layout:
//   [0-1]    Magic (0xFB12)
//   [2]      Version (1)
//   [3-4]    CRC16
//   [5-24]   PinMap (20 bytes)
//   [25]     SensorCount
//   [26-89]  Sensors[8] × 8 bytes
//   [90]     ControlCount
//   [91-122] Controls[8] × 4 bytes
//   [123]    RuleCount
//   [124-635] Rules[32] × 16 bytes
//   [636-637] TxIntervalSec
//   [638-925] WiFiSettings (288 bytes)

// rp2040Config is the composite settings struct for the RP2040 target.
type rp2040Config struct {
	Core settings.CoreSettings
	WiFi rp2040transport.WiFiSettings
}

const (
	rp2040Magic   = uint16(0xFB12)
	rp2040Version = uint8(1)
)

const offPinMap = 5

const (
	offSensors  = offPinMap + settings.MaxPins                // 25
	offControls = offSensors + 1 + settings.MaxSensors*8     // 90
	offRules    = offControls + 1 + settings.MaxControls*4   // 123
	offInterval = offRules + 1 + settings.MaxRules*16        // 636
	offWiFi     = offInterval + 2                             // 638
)

func encodeSettings(s rp2040Config) []byte {
	buf := make([]byte, settings.SettingsSize)
	binary.LittleEndian.PutUint16(buf[0:], rp2040Magic)
	buf[2] = rp2040Version

	for i := 0; i < settings.MaxPins; i++ {
		buf[offPinMap+i] = uint8(s.Core.PinMap[i])
	}

	off := offSensors
	buf[off] = s.Core.SensorCount
	off++
	for i := 0; i < settings.MaxSensors; i++ {
		buf[off] = uint8(s.Core.Sensors[i].Type)
		buf[off+1] = s.Core.Sensors[i].PinIndex
		buf[off+2] = s.Core.Sensors[i].FieldIndex
		buf[off+3] = s.Core.Sensors[i].Flags
		binary.LittleEndian.PutUint16(buf[off+4:], s.Core.Sensors[i].Param1)
		binary.LittleEndian.PutUint16(buf[off+6:], s.Core.Sensors[i].Param2)
		off += 8
	}

	buf[off] = s.Core.ControlCount
	off++
	for i := 0; i < settings.MaxControls; i++ {
		buf[off] = s.Core.Controls[i].PinIndex
		buf[off+1] = s.Core.Controls[i].StateCount
		buf[off+2] = s.Core.Controls[i].Flags
		off += 4
	}

	buf[off] = s.Core.RuleCount
	off++
	for i := 0; i < settings.MaxRules; i++ {
		s.Core.Rules[i].ToBinary(buf[off:])
		off += settings.RuleSize
	}

	binary.LittleEndian.PutUint16(buf[offInterval:], s.Core.TxIntervalSec)

	// WiFiSettings block
	wifiBytes := rp2040transport.EncodeWiFiSettings(s.WiFi)
	copy(buf[offWiFi:], wifiBytes)

	return buf
}

func decodeSettings(buf []byte) rp2040Config {
	if len(buf) < 5 {
		return defaultConfig()
	}
	magic := binary.LittleEndian.Uint16(buf[0:])
	if magic != rp2040Magic {
		return defaultConfig()
	}
	if buf[2] != rp2040Version {
		return defaultConfig()
	}
	return decode(buf)
}

func decode(buf []byte) rp2040Config {
	if len(buf) < offWiFi+rp2040transport.WiFiSettingsSize {
		return defaultConfig()
	}
	var c rp2040Config

	for i := 0; i < settings.MaxPins; i++ {
		c.Core.PinMap[i] = settings.PinFunction(buf[offPinMap+i])
	}

	off := offSensors
	c.Core.SensorCount = buf[off]
	off++
	for i := 0; i < settings.MaxSensors; i++ {
		c.Core.Sensors[i].Type = settings.SensorType(buf[off])
		c.Core.Sensors[i].PinIndex = buf[off+1]
		c.Core.Sensors[i].FieldIndex = buf[off+2]
		c.Core.Sensors[i].Flags = buf[off+3]
		c.Core.Sensors[i].Param1 = binary.LittleEndian.Uint16(buf[off+4:])
		c.Core.Sensors[i].Param2 = binary.LittleEndian.Uint16(buf[off+6:])
		off += 8
	}

	off = offControls
	c.Core.ControlCount = buf[off]
	off++
	for i := 0; i < settings.MaxControls; i++ {
		c.Core.Controls[i].PinIndex = buf[off]
		c.Core.Controls[i].StateCount = buf[off+1]
		c.Core.Controls[i].Flags = buf[off+2]
		off += 4
	}

	off = offRules
	c.Core.RuleCount = buf[off]
	off++
	for i := 0; i < settings.MaxRules; i++ {
		c.Core.Rules[i].FromBinary(buf[off:])
		off += settings.RuleSize
	}

	c.Core.TxIntervalSec = binary.LittleEndian.Uint16(buf[offInterval:])
	c.WiFi = rp2040transport.DecodeWiFiSettings(buf[offWiFi:])
	return c
}

func defaultConfig() rp2040Config {
	return rp2040Config{
		Core: settings.Defaults(),
		WiFi: rp2040transport.WiFiSettings{}, // populated via provisioning tool
	}
}
