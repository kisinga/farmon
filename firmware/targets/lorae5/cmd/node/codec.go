package main

import (
	"encoding/binary"

	"github.com/farmon/firmware/pkg/settings"
)

// Binary codec for LoRa-E5 flash storage (v3).
//
// Flash layout (v3):
//   [0-1]     Magic (0xFA12)
//   [2]       Version (3)
//   [3-4]     CRC16
//   [5-24]    PinMap (20 bytes)
//   [25]      SensorCount
//   [26-281]  Sensors[32] × 8 bytes  = 256 bytes
//   [282]     ControlCount
//   [283-410] Controls[16] × 8 bytes = 128 bytes
//   [411]     RuleCount
//   [412-923] Rules[32] × 16 bytes   = 512 bytes
//   [924-925] TxIntervalSec
//   [926-941] TransferConfig         = 16 bytes
//   [942-971] LoRaWAN block          = 30 bytes
//   [972-975] ConfigHash             = 4 bytes

type nodeConfig struct {
	Core    settings.CoreSettings
	LoRaWAN settings.LoRaWANSettings
}

const (
	offPinMap     = 5
	offSensors    = offPinMap + settings.MaxPins                                      // 25
	offControls   = offSensors + 1 + settings.MaxSensors*settings.SensorSlotSize      // 282
	offRules      = offControls + 1 + settings.MaxControls*settings.ControlSlotSize   // 411
	offInterval   = offRules + 1 + settings.MaxRules*settings.RuleSize                // 924
	offTransfer   = offInterval + 2                                                   // 926
	offLoRaWAN    = offTransfer + settings.TransferConfigSize                         // 942
	offConfigHash = offLoRaWAN + 30                                                   // 972
)

const loraeMagic   = uint16(0xFA12)
const loraeVersion = uint8(3)

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
		off += settings.SensorSlotSize
	}

	buf[off] = s.Core.ControlCount
	off++
	for i := 0; i < settings.MaxControls; i++ {
		buf[off] = s.Core.Controls[i].PinIndex
		buf[off+1] = s.Core.Controls[i].StateCount
		buf[off+2] = s.Core.Controls[i].Flags
		buf[off+3] = uint8(s.Core.Controls[i].ActuatorType)
		buf[off+4] = s.Core.Controls[i].Pin2Index
		buf[off+5] = s.Core.Controls[i].PulseDurX100ms
		// [6] and [7] are reserved, left zero
		off += settings.ControlSlotSize
	}

	buf[off] = s.Core.RuleCount
	off++
	for i := 0; i < settings.MaxRules; i++ {
		s.Core.Rules[i].ToBinary(buf[off:])
		off += settings.RuleSize
	}

	binary.LittleEndian.PutUint16(buf[offInterval:], s.Core.TxIntervalSec)
	writeTransfer(buf, offTransfer, &s.Core.Transfer)
	writeLoRaWAN(buf, offLoRaWAN, &s.LoRaWAN)
	binary.LittleEndian.PutUint32(buf[offConfigHash:], s.Core.ConfigHash)

	return buf
}

func decodeSettings(buf []byte) nodeConfig {
	if len(buf) < offConfigHash+4 {
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
		off += settings.SensorSlotSize
	}

	off = offControls
	nc.Core.ControlCount = buf[off]
	off++
	for i := 0; i < settings.MaxControls; i++ {
		nc.Core.Controls[i].PinIndex = buf[off]
		nc.Core.Controls[i].StateCount = buf[off+1]
		nc.Core.Controls[i].Flags = buf[off+2]
		nc.Core.Controls[i].ActuatorType = settings.ActuatorType(buf[off+3])
		nc.Core.Controls[i].Pin2Index = buf[off+4]
		nc.Core.Controls[i].PulseDurX100ms = buf[off+5]
		off += settings.ControlSlotSize
	}

	off = offRules
	nc.Core.RuleCount = buf[off]
	off++
	for i := 0; i < settings.MaxRules; i++ {
		nc.Core.Rules[i].FromBinary(buf[off:])
		off += settings.RuleSize
	}

	nc.Core.TxIntervalSec = binary.LittleEndian.Uint16(buf[offInterval:])
	readTransfer(buf, offTransfer, &nc.Core.Transfer)
	readLoRaWAN(buf, offLoRaWAN, &nc.LoRaWAN)
	if len(buf) >= offConfigHash+4 {
		nc.Core.ConfigHash = binary.LittleEndian.Uint32(buf[offConfigHash:])
	}
	return nc
}

func defaultNodeConfig() nodeConfig {
	return nodeConfig{
		Core:    settings.Defaults(),
		LoRaWAN: settings.LoRaWANDefaults(),
	}
}

func readTransfer(buf []byte, off int, t *settings.TransferConfig) {
	t.Enabled = buf[off]
	t.PumpCtrlIdx = buf[off+1]
	t.ValveT1CtrlIdx = buf[off+2]
	t.ValveT2CtrlIdx = buf[off+3]
	t.SVCtrlIdx = buf[off+4]
	t.LevelT1FieldIdx = buf[off+5]
	t.LevelT2FieldIdx = buf[off+6]
	t.StartDeltaPct = buf[off+7]
	t.StopT1MinPct = buf[off+8]
	t.MeasurePulseSec = buf[off+9]
	t.Flags = buf[off+10]
}

func writeTransfer(buf []byte, off int, t *settings.TransferConfig) {
	buf[off] = t.Enabled
	buf[off+1] = t.PumpCtrlIdx
	buf[off+2] = t.ValveT1CtrlIdx
	buf[off+3] = t.ValveT2CtrlIdx
	buf[off+4] = t.SVCtrlIdx
	buf[off+5] = t.LevelT1FieldIdx
	buf[off+6] = t.LevelT2FieldIdx
	buf[off+7] = t.StartDeltaPct
	buf[off+8] = t.StopT1MinPct
	buf[off+9] = t.MeasurePulseSec
	buf[off+10] = t.Flags
	// [11-15] reserved, left zero
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
