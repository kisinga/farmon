package main

import (
	"encoding/binary"

	"github.com/farm/lorae5/pkg/settings"
)

// Binary codec for DeviceSettings <-> flash storage.
//
// V1 layout (settings.Version == 1): SensorSlot=6 bytes, Rule=12 bytes
// V2 layout (settings.Version == 2): SensorSlot=8 bytes, Rule=16 bytes
//
// decodeSettings detects the version byte and migrates V1→V2 transparently.
// encodeSettings always writes V2.

// V1 offsets (for reading legacy flash written by version-1 firmware)
const (
	offPinMap      = 5                                          // 20 bytes
	offSensorsV1   = offPinMap + settings.MaxPins               // 25
	offControlsV1  = offSensorsV1 + 1 + settings.MaxSensors*6  // 25+1+48 = 74
	offRulesV1     = offControlsV1 + 1 + settings.MaxControls*4 // 74+1+32 = 107
	offLoRaWANV1   = offRulesV1 + 1 + settings.MaxRules*12     // 107+1+384 = 492
	offIntervalV1  = offLoRaWANV1 + 30                          // 522
)

// V2 offsets (current format)
const (
	offSensorsV2  = offPinMap + settings.MaxPins                 // 25
	offControlsV2 = offSensorsV2 + 1 + settings.MaxSensors*8    // 25+1+64 = 90
	offRulesV2    = offControlsV2 + 1 + settings.MaxControls*4  // 90+1+32 = 123
	offLoRaWANV2  = offRulesV2 + 1 + settings.MaxRules*16       // 123+1+512 = 636
	offIntervalV2 = offLoRaWANV2 + 30                            // 666
)

func encodeSettings(s settings.DeviceSettings) []byte {
	buf := make([]byte, settings.SettingsSize)
	binary.LittleEndian.PutUint16(buf[0:], settings.Magic)
	buf[2] = settings.Version // always write current version

	for i := 0; i < settings.MaxPins; i++ {
		buf[offPinMap+i] = uint8(s.PinMap[i])
	}

	off := offSensorsV2
	buf[off] = s.SensorCount
	off++
	for i := 0; i < settings.MaxSensors; i++ {
		buf[off] = uint8(s.Sensors[i].Type)
		buf[off+1] = s.Sensors[i].PinIndex
		buf[off+2] = s.Sensors[i].FieldIndex
		buf[off+3] = s.Sensors[i].Flags
		binary.LittleEndian.PutUint16(buf[off+4:], s.Sensors[i].Param1)
		binary.LittleEndian.PutUint16(buf[off+6:], s.Sensors[i].Param2)
		off += 8
	}

	buf[off] = s.ControlCount
	off++
	for i := 0; i < settings.MaxControls; i++ {
		buf[off] = s.Controls[i].PinIndex
		buf[off+1] = s.Controls[i].StateCount
		buf[off+2] = s.Controls[i].Flags
		off += 4
	}

	buf[off] = s.RuleCount
	off++
	for i := 0; i < settings.MaxRules; i++ {
		s.Rules[i].ToBinary(buf[off:])
		off += settings.RuleSize // 16 bytes
	}

	writeLoRaWAN(buf, off, &s)
	off += 30
	binary.LittleEndian.PutUint16(buf[off:], s.TxIntervalSec)

	return buf
}

func decodeSettings(buf []byte) settings.DeviceSettings {
	if len(buf) < 5 {
		return settings.Defaults()
	}
	magic := binary.LittleEndian.Uint16(buf[0:])
	if magic != settings.Magic {
		return settings.Defaults()
	}
	version := buf[2]
	switch version {
	case 1:
		return migrateV1toV2(decodeV1(buf))
	case 2:
		return decodeV2(buf)
	default:
		return settings.Defaults()
	}
}

// decodeV1 reads a V1-format flash buffer (6-byte SensorSlot, 12-byte Rule).
func decodeV1(buf []byte) settings.DeviceSettings {
	if len(buf) < offIntervalV1+2 {
		return settings.Defaults()
	}
	s := settings.DeviceSettings{}
	s.MagicWord = settings.Magic
	s.Version = 1

	for i := 0; i < settings.MaxPins; i++ {
		s.PinMap[i] = settings.PinFunction(buf[offPinMap+i])
	}

	off := offSensorsV1
	s.SensorCount = buf[off]
	off++
	for i := 0; i < settings.MaxSensors; i++ {
		s.Sensors[i].Type = settings.SensorType(buf[off])
		s.Sensors[i].PinIndex = buf[off+1]
		s.Sensors[i].FieldIndex = buf[off+2]
		s.Sensors[i].Flags = buf[off+3]
		s.Sensors[i].Param1 = binary.LittleEndian.Uint16(buf[off+4:])
		s.Sensors[i].Param2 = 0 // not present in V1
		off += 6
	}

	off = offControlsV1
	s.ControlCount = buf[off]
	off++
	for i := 0; i < settings.MaxControls; i++ {
		s.Controls[i].PinIndex = buf[off]
		s.Controls[i].StateCount = buf[off+1]
		s.Controls[i].Flags = buf[off+2]
		off += 4
	}

	off = offRulesV1
	s.RuleCount = buf[off]
	off++
	for i := 0; i < settings.MaxRules; i++ {
		s.Rules[i].FromBinary(buf[off:]) // FromBinary handles both 12 and 16-byte
		off += 12
	}

	readLoRaWAN(buf, offLoRaWANV1, &s)
	s.TxIntervalSec = binary.LittleEndian.Uint16(buf[offIntervalV1:])
	return s
}

// decodeV2 reads a V2-format flash buffer (8-byte SensorSlot, 16-byte Rule).
func decodeV2(buf []byte) settings.DeviceSettings {
	if len(buf) < offIntervalV2+2 {
		return settings.Defaults()
	}
	s := settings.DeviceSettings{}
	s.MagicWord = settings.Magic
	s.Version = 2

	for i := 0; i < settings.MaxPins; i++ {
		s.PinMap[i] = settings.PinFunction(buf[offPinMap+i])
	}

	off := offSensorsV2
	s.SensorCount = buf[off]
	off++
	for i := 0; i < settings.MaxSensors; i++ {
		s.Sensors[i].Type = settings.SensorType(buf[off])
		s.Sensors[i].PinIndex = buf[off+1]
		s.Sensors[i].FieldIndex = buf[off+2]
		s.Sensors[i].Flags = buf[off+3]
		s.Sensors[i].Param1 = binary.LittleEndian.Uint16(buf[off+4:])
		s.Sensors[i].Param2 = binary.LittleEndian.Uint16(buf[off+6:])
		off += 8
	}

	off = offControlsV2
	s.ControlCount = buf[off]
	off++
	for i := 0; i < settings.MaxControls; i++ {
		s.Controls[i].PinIndex = buf[off]
		s.Controls[i].StateCount = buf[off+1]
		s.Controls[i].Flags = buf[off+2]
		off += 4
	}

	off = offRulesV2
	s.RuleCount = buf[off]
	off++
	for i := 0; i < settings.MaxRules; i++ {
		s.Rules[i].FromBinary(buf[off:])
		off += settings.RuleSize // 16 bytes
	}

	readLoRaWAN(buf, offLoRaWANV2, &s)
	s.TxIntervalSec = binary.LittleEndian.Uint16(buf[offIntervalV2:])
	return s
}

// migrateV1toV2 upgrades a decoded V1 struct to V2 in memory.
// Param2 is zero-filled (correct default for all existing V1 sensor types).
func migrateV1toV2(s settings.DeviceSettings) settings.DeviceSettings {
	s.Version = settings.Version // 2
	s.MagicWord = settings.Magic
	// Param2 already zero-filled by decodeV1. Nothing else to change.
	return s
}

// readLoRaWAN extracts LoRaWAN config from buf starting at off.
func readLoRaWAN(buf []byte, off int, s *settings.DeviceSettings) {
	s.LoRaWAN.Region = buf[off]
	s.LoRaWAN.SubBand = buf[off+1]
	s.LoRaWAN.DataRate = buf[off+2]
	s.LoRaWAN.TxPower = buf[off+3]
	s.LoRaWAN.ADREnabled = buf[off+4] == 1
	s.LoRaWAN.Confirmed = buf[off+5] == 1
	copy(s.LoRaWAN.AppEUI[:], buf[off+6:off+14])
	copy(s.LoRaWAN.AppKey[:], buf[off+14:off+30])
}

// writeLoRaWAN encodes LoRaWAN config into buf starting at off.
func writeLoRaWAN(buf []byte, off int, s *settings.DeviceSettings) {
	buf[off] = s.LoRaWAN.Region
	buf[off+1] = s.LoRaWAN.SubBand
	buf[off+2] = s.LoRaWAN.DataRate
	buf[off+3] = s.LoRaWAN.TxPower
	if s.LoRaWAN.ADREnabled {
		buf[off+4] = 1
	}
	if s.LoRaWAN.Confirmed {
		buf[off+5] = 1
	}
	copy(buf[off+6:off+14], s.LoRaWAN.AppEUI[:])
	copy(buf[off+14:off+30], s.LoRaWAN.AppKey[:])
}
