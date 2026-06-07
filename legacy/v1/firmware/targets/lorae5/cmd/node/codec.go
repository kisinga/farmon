package main

import (
	"encoding/binary"
	"github.com/kisinga/farmon/firmware/pkg/settings"
)

type nodeConfig struct {
	Core    settings.CoreSettings
	LoRaWAN settings.LoRaWANSettings
}

const (
	offPinMap       = 5
	offSensors      = offPinMap + settings.MaxPins
	offControls     = offSensors + 1 + settings.MaxSensors*settings.SensorSlotSize
	offRules        = offControls + 1 + settings.MaxControls*settings.ControlSlotSize
	offInterval     = offRules + 1 + settings.MaxRules*settings.RuleSize
	offEvalInterval = offInterval + 2
	offTransfer     = offEvalInterval + 2
	offLoRaWAN      = offTransfer + settings.TransferConfigSize
	offConfigHash   = offLoRaWAN + 30
)

const loraeMagic   = uint16(0xFA12)
const loraeVersion = uint8(4)

func encodeSettings(s *nodeConfig) []byte {
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
		off += settings.ControlSlotSize
	}
	buf[off] = s.Core.RuleCount
	off++
	for i := 0; i < settings.MaxRules; i++ {
		s.Core.Rules[i].ToBinary(buf[off:])
		off += settings.RuleSize
	}
	binary.LittleEndian.PutUint16(buf[offInterval:], s.Core.TxIntervalSec)
	binary.LittleEndian.PutUint16(buf[offEvalInterval:], s.Core.EvalIntervalSec)
	writeTransfer(buf, offTransfer, &s.Core.Transfer)
	writeLoRaWAN(buf, offLoRaWAN, &s.LoRaWAN)
	binary.LittleEndian.PutUint32(buf[offConfigHash:], s.Core.ConfigHash)
	return buf
}

func decodeSettings(buf []byte) {
	if len(buf) < offConfigHash+4 { initDefaults(); return }
	magic := binary.LittleEndian.Uint16(buf[0:])
	if magic != loraeMagic || buf[2] != loraeVersion { initDefaults(); return }
	for i := 0; i < settings.MaxPins; i++ {
		cfg.Core.PinMap[i] = settings.PinFunction(buf[offPinMap+i])
	}
	off := offSensors
	cfg.Core.SensorCount = buf[off]
	off++
	for i := 0; i < settings.MaxSensors; i++ {
		cfg.Core.Sensors[i].Type = settings.SensorType(buf[off])
		cfg.Core.Sensors[i].PinIndex = buf[off+1]
		cfg.Core.Sensors[i].FieldIndex = buf[off+2]
		cfg.Core.Sensors[i].Flags = buf[off+3]
		cfg.Core.Sensors[i].Param1 = binary.LittleEndian.Uint16(buf[off+4:])
		cfg.Core.Sensors[i].Param2 = binary.LittleEndian.Uint16(buf[off+6:])
		off += settings.SensorSlotSize
	}
	off = offControls
	cfg.Core.ControlCount = buf[off]
	off++
	for i := 0; i < settings.MaxControls; i++ {
		cfg.Core.Controls[i].PinIndex = buf[off]
		cfg.Core.Controls[i].StateCount = buf[off+1]
		cfg.Core.Controls[i].Flags = buf[off+2]
		cfg.Core.Controls[i].ActuatorType = settings.ActuatorType(buf[off+3])
		cfg.Core.Controls[i].Pin2Index = buf[off+4]
		cfg.Core.Controls[i].PulseDurX100ms = buf[off+5]
		off += settings.ControlSlotSize
	}
	off = offRules
	cfg.Core.RuleCount = buf[off]
	off++
	for i := 0; i < settings.MaxRules; i++ {
		cfg.Core.Rules[i].FromBinary(buf[off:])
		off += settings.RuleSize
	}
	cfg.Core.TxIntervalSec = binary.LittleEndian.Uint16(buf[offInterval:])
	cfg.Core.EvalIntervalSec = binary.LittleEndian.Uint16(buf[offEvalInterval:])
	readTransfer(buf, offTransfer, &cfg.Core.Transfer)
	readLoRaWAN(buf, offLoRaWAN, &cfg.LoRaWAN)
	if len(buf) >= offConfigHash+4 {
		cfg.Core.ConfigHash = binary.LittleEndian.Uint32(buf[offConfigHash:])
	}
}

func initDefaults() {
	settings.ResetDefaults(&cfg.Core)
	cfg.LoRaWAN = settings.LoRaWANDefaults()
}

func readTransfer(buf []byte, off int, t *settings.TransferConfig) {
	t.Enabled = buf[off]; t.PumpCtrlIdx = buf[off+1]; t.ValveT1CtrlIdx = buf[off+2]
	t.ValveT2CtrlIdx = buf[off+3]; t.SVCtrlIdx = buf[off+4]; t.LevelT1FieldIdx = buf[off+5]
	t.LevelT2FieldIdx = buf[off+6]; t.StartDeltaPct = buf[off+7]; t.StopT1MinPct = buf[off+8]
	t.MeasurePulseSec = buf[off+9]; t.Flags = buf[off+10]
}

func writeTransfer(buf []byte, off int, t *settings.TransferConfig) {
	buf[off] = t.Enabled; buf[off+1] = t.PumpCtrlIdx; buf[off+2] = t.ValveT1CtrlIdx
	buf[off+3] = t.ValveT2CtrlIdx; buf[off+4] = t.SVCtrlIdx; buf[off+5] = t.LevelT1FieldIdx
	buf[off+6] = t.LevelT2FieldIdx; buf[off+7] = t.StartDeltaPct; buf[off+8] = t.StopT1MinPct
	buf[off+9] = t.MeasurePulseSec; buf[off+10] = t.Flags
}

func readLoRaWAN(buf []byte, off int, lora *settings.LoRaWANSettings) {
	lora.Region = buf[off]; lora.SubBand = buf[off+1]; lora.DataRate = buf[off+2]
	lora.TxPower = buf[off+3]; lora.ADREnabled = buf[off+4] == 1; lora.Confirmed = buf[off+5] == 1
	copy(lora.AppEUI[:], buf[off+6:off+14]); copy(lora.AppKey[:], buf[off+14:off+30])
}

func writeLoRaWAN(buf []byte, off int, lora *settings.LoRaWANSettings) {
	buf[off] = lora.Region; buf[off+1] = lora.SubBand; buf[off+2] = lora.DataRate
	buf[off+3] = lora.TxPower
	if lora.ADREnabled { buf[off+4] = 1 }
	if lora.Confirmed { buf[off+5] = 1 }
	copy(buf[off+6:off+14], lora.AppEUI[:]); copy(buf[off+14:off+30], lora.AppKey[:])
}
