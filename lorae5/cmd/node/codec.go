package main

import (
	"encoding/binary"

	"github.com/farm/lorae5/pkg/settings"
)

// Binary codec for DeviceSettings <-> flash storage.
// Fixed offsets for forward-compatible layout.

const (
	offPinMap   = 5
	offSensors  = offPinMap + settings.MaxPins // 25
	offControls = offSensors + 1 + settings.MaxSensors*6
	offRules    = offControls + 1 + settings.MaxControls*4
	offLoRaWAN  = offRules + 1 + settings.MaxRules*12
	offInterval = offLoRaWAN + 30
)

func encodeSettings(s settings.DeviceSettings) []byte {
	buf := make([]byte, settings.SettingsSize)
	binary.LittleEndian.PutUint16(buf[0:], s.MagicWord)
	buf[2] = s.Version

	for i := 0; i < settings.MaxPins; i++ {
		buf[offPinMap+i] = uint8(s.PinMap[i])
	}

	off := offSensors
	buf[off] = s.SensorCount
	off++
	for i := 0; i < settings.MaxSensors; i++ {
		buf[off] = uint8(s.Sensors[i].Type)
		buf[off+1] = s.Sensors[i].PinIndex
		buf[off+2] = s.Sensors[i].FieldIndex
		buf[off+3] = s.Sensors[i].Flags
		binary.LittleEndian.PutUint16(buf[off+4:], s.Sensors[i].Param1)
		off += 6
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
		off += 12
	}

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
	off += 30

	binary.LittleEndian.PutUint16(buf[off:], s.TxIntervalSec)

	return buf
}

func decodeSettings(buf []byte) settings.DeviceSettings {
	if len(buf) < offInterval+2 {
		return settings.Defaults()
	}

	s := settings.DeviceSettings{}
	s.MagicWord = binary.LittleEndian.Uint16(buf[0:])
	if s.MagicWord != settings.Magic {
		return settings.Defaults()
	}
	s.Version = buf[2]

	for i := 0; i < settings.MaxPins; i++ {
		s.PinMap[i] = settings.PinFunction(buf[offPinMap+i])
	}

	off := offSensors
	s.SensorCount = buf[off]
	off++
	for i := 0; i < settings.MaxSensors; i++ {
		s.Sensors[i].Type = settings.SensorType(buf[off])
		s.Sensors[i].PinIndex = buf[off+1]
		s.Sensors[i].FieldIndex = buf[off+2]
		s.Sensors[i].Flags = buf[off+3]
		s.Sensors[i].Param1 = binary.LittleEndian.Uint16(buf[off+4:])
		off += 6
	}

	s.ControlCount = buf[off]
	off++
	for i := 0; i < settings.MaxControls; i++ {
		s.Controls[i].PinIndex = buf[off]
		s.Controls[i].StateCount = buf[off+1]
		s.Controls[i].Flags = buf[off+2]
		off += 4
	}

	s.RuleCount = buf[off]
	off++
	for i := 0; i < settings.MaxRules; i++ {
		s.Rules[i].FromBinary(buf[off:])
		off += 12
	}

	s.LoRaWAN.Region = buf[off]
	s.LoRaWAN.SubBand = buf[off+1]
	s.LoRaWAN.DataRate = buf[off+2]
	s.LoRaWAN.TxPower = buf[off+3]
	s.LoRaWAN.ADREnabled = buf[off+4] == 1
	s.LoRaWAN.Confirmed = buf[off+5] == 1
	copy(s.LoRaWAN.AppEUI[:], buf[off+6:off+14])
	copy(s.LoRaWAN.AppKey[:], buf[off+14:off+30])
	off += 30

	s.TxIntervalSec = binary.LittleEndian.Uint16(buf[off:])

	return s
}
