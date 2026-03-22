package main

import (
	"encoding/binary"

	"github.com/kisinga/farmon/firmware/pkg/settings"
	esptransport "github.com/kisinga/farmon/firmware/targets/heltec_v3/pkg/transport"
)

// Binary codec for ESP32-S3 flash storage (v1).
// Same layout as RP2040 v4 — shared CoreSettings + WiFiSettings.

type esp32s3Config struct {
	Core settings.CoreSettings
	WiFi esptransport.WiFiSettings
}

const (
	esp32s3Magic   = uint16(0xFB13)
	esp32s3Version = uint8(1)
)

const (
	offPinMap       = 5
	offSensors      = offPinMap + settings.MaxPins
	offControls     = offSensors + 1 + settings.MaxSensors*settings.SensorSlotSize
	offRules        = offControls + 1 + settings.MaxControls*settings.ControlSlotSize
	offInterval     = offRules + 1 + settings.MaxRules*settings.RuleSize
	offEvalInterval = offInterval + 2
	offTransfer     = offEvalInterval + 2
	offWiFi         = offTransfer + settings.TransferConfigSize
	offConfigHash   = offWiFi + esptransport.WiFiSettingsSize
)

func encodeSettings(s esp32s3Config) []byte {
	buf := make([]byte, settings.SettingsSize)
	binary.LittleEndian.PutUint16(buf[0:], esp32s3Magic)
	buf[2] = esp32s3Version

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
	wifiBytes := esptransport.EncodeWiFiSettings(s.WiFi)
	copy(buf[offWiFi:], wifiBytes)
	binary.LittleEndian.PutUint32(buf[offConfigHash:], s.Core.ConfigHash)

	return buf
}

func decodeSettings(buf []byte) esp32s3Config {
	if len(buf) < offConfigHash+4 {
		return baseConfig()
	}
	magic := binary.LittleEndian.Uint16(buf[0:])
	if magic != esp32s3Magic || buf[2] != esp32s3Version {
		return baseConfig()
	}

	var c esp32s3Config

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
		off += settings.SensorSlotSize
	}

	off = offControls
	c.Core.ControlCount = buf[off]
	off++
	for i := 0; i < settings.MaxControls; i++ {
		c.Core.Controls[i].PinIndex = buf[off]
		c.Core.Controls[i].StateCount = buf[off+1]
		c.Core.Controls[i].Flags = buf[off+2]
		c.Core.Controls[i].ActuatorType = settings.ActuatorType(buf[off+3])
		c.Core.Controls[i].Pin2Index = buf[off+4]
		c.Core.Controls[i].PulseDurX100ms = buf[off+5]
		off += settings.ControlSlotSize
	}

	off = offRules
	c.Core.RuleCount = buf[off]
	off++
	for i := 0; i < settings.MaxRules; i++ {
		c.Core.Rules[i].FromBinary(buf[off:])
		off += settings.RuleSize
	}

	c.Core.TxIntervalSec = binary.LittleEndian.Uint16(buf[offInterval:])
	c.Core.EvalIntervalSec = binary.LittleEndian.Uint16(buf[offEvalInterval:])
	readTransfer(buf, offTransfer, &c.Core.Transfer)
	c.WiFi = esptransport.DecodeWiFiSettings(buf[offWiFi:])
	if len(buf) >= offConfigHash+4 {
		c.Core.ConfigHash = binary.LittleEndian.Uint32(buf[offConfigHash:])
	}
	return c
}

func baseConfig() esp32s3Config {
	return esp32s3Config{
		Core: settings.Defaults(),
		WiFi: esptransport.WiFiSettings{},
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
}
