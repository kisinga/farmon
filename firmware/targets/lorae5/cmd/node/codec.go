package main

import (
	"encoding/binary"

	"github.com/farm/firmware/pkg/settings"
)

// Binary codec for LoRa-E5 flash storage.
//
// Flash layout:
//   [0-1]   Magic (0xFA12)
//   [2]     Version (1)
//   [3-4]   CRC16
//   [5-24]  PinMap (20 bytes)
//   [25]    SensorCount
//   [26-89] Sensors[8] × 8 bytes
//   [90]    ControlCount
//   [91-122] Controls[8] × 4 bytes
//   [123]   RuleCount
//   [124-635] Rules[32] × 16 bytes
//   [636-637] TxIntervalSec
//   [638-667] LoRaWAN block (30 bytes)

// nodeConfig is the composite settings struct for the LoRa-E5 target.
type nodeConfig struct {
	Core    settings.CoreSettings
	LoRaWAN settings.LoRaWANSettings
}

const (
	offPinMap   = 5
	offSensors  = offPinMap + settings.MaxPins               // 25
	offControls = offSensors + 1 + settings.MaxSensors*8     // 90
	offRules    = offControls + 1 + settings.MaxControls*4   // 123
	offInterval = offRules + 1 + settings.MaxRules*16        // 636
	offLoRaWAN  = offInterval + 2                            // 638
)

const loraeMagic   = uint16(0xFA12)
const loraeVersion = uint8(1)

func encodeSettings(s nodeConfig) []byte {
	buf := make([]byte, settings.SettingsSize)
	binary.LittleEndian.PutUint16(buf[0:], loraeMagic)
	buf[2] = loraeVersion

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
	writeLoRaWAN(buf, offLoRaWAN, &s.LoRaWAN)

	return buf
}

func decodeSettings(buf []byte) nodeConfig {
	if len(buf) < offLoRaWAN+30 {
		return defaultNodeConfig()
	}
	magic := binary.LittleEndian.Uint16(buf[0:])
	if magic != loraeMagic || buf[2] != loraeVersion {
		return defaultNodeConfig()
	}

	var nc nodeConfig

	for i := 0; i < settings.MaxPins; i++ {
		nc.Core.PinMap[i] = settings.PinFunction(buf[offPinMap+i])
	}

	off := offSensors
	nc.Core.SensorCount = buf[off]
	off++
	for i := 0; i < settings.MaxSensors; i++ {
		nc.Core.Sensors[i].Type = settings.SensorType(buf[off])
		nc.Core.Sensors[i].PinIndex = buf[off+1]
		nc.Core.Sensors[i].FieldIndex = buf[off+2]
		nc.Core.Sensors[i].Flags = buf[off+3]
		nc.Core.Sensors[i].Param1 = binary.LittleEndian.Uint16(buf[off+4:])
		nc.Core.Sensors[i].Param2 = binary.LittleEndian.Uint16(buf[off+6:])
		off += 8
	}

	off = offControls
	nc.Core.ControlCount = buf[off]
	off++
	for i := 0; i < settings.MaxControls; i++ {
		nc.Core.Controls[i].PinIndex = buf[off]
		nc.Core.Controls[i].StateCount = buf[off+1]
		nc.Core.Controls[i].Flags = buf[off+2]
		off += 4
	}

	off = offRules
	nc.Core.RuleCount = buf[off]
	off++
	for i := 0; i < settings.MaxRules; i++ {
		nc.Core.Rules[i].FromBinary(buf[off:])
		off += settings.RuleSize
	}

	nc.Core.TxIntervalSec = binary.LittleEndian.Uint16(buf[offInterval:])
	readLoRaWAN(buf, offLoRaWAN, &nc.LoRaWAN)
	return nc
}

func defaultNodeConfig() nodeConfig {
	return nodeConfig{
		Core:    settings.Defaults(),
		LoRaWAN: settings.LoRaWANDefaults(),
	}
}

func readLoRaWAN(buf []byte, off int, lora *settings.LoRaWANSettings) {
	lora.Region = buf[off]
	lora.SubBand = buf[off+1]
	lora.DataRate = buf[off+2]
	lora.TxPower = buf[off+3]
	lora.ADREnabled = buf[off+4] == 1
	lora.Confirmed = buf[off+5] == 1
	copy(lora.AppEUI[:], buf[off+6:off+14])
	copy(lora.AppKey[:], buf[off+14:off+30])
}

func writeLoRaWAN(buf []byte, off int, lora *settings.LoRaWANSettings) {
	buf[off] = lora.Region
	buf[off+1] = lora.SubBand
	buf[off+2] = lora.DataRate
	buf[off+3] = lora.TxPower
	if lora.ADREnabled {
		buf[off+4] = 1
	}
	if lora.Confirmed {
		buf[off+5] = 1
	}
	copy(buf[off+6:off+14], lora.AppEUI[:])
	copy(buf[off+14:off+30], lora.AppKey[:])
}
