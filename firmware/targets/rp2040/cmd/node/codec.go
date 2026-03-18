package main

import (
	"encoding/binary"

	"github.com/farmon/firmware/pkg/settings"
	rp2040transport "github.com/farmon/firmware/targets/rp2040/pkg/transport"
)

// Binary codec for RP2040 flash storage (v4).
//
// Flash layout (v4):
//   [0-1]       Magic (0xFB12)
//   [2]         Version (4)
//   [3-4]       CRC16
//   [5-24]      PinMap (20 bytes)
//   [25]        SensorCount
//   [26-281]    Sensors[32] × 8 bytes  = 256 bytes
//   [282]       ControlCount
//   [283-410]   Controls[16] × 8 bytes = 128 bytes
//   [411]       RuleCount
//   [412-795]   Rules[16] × 24 bytes   = 384 bytes
//   [796-797]   TxIntervalSec
//   [798-799]   EvalIntervalSec
//   [800-815]   TransferConfig         = 16 bytes
//   [816-1103]  WiFiSettings           = 288 bytes
//   [1104-1107] ConfigHash             = 4 bytes

type rp2040Config struct {
	Core settings.CoreSettings
	WiFi rp2040transport.WiFiSettings
}

const (
	rp2040Magic   = uint16(0xFB12)
	rp2040Version = uint8(4)
)

const (
	offPinMap       = 5
	offSensors      = offPinMap + settings.MaxPins                                    // 25
	offControls     = offSensors + 1 + settings.MaxSensors*settings.SensorSlotSize    // 282
	offRules        = offControls + 1 + settings.MaxControls*settings.ControlSlotSize // 411
	offInterval     = offRules + 1 + settings.MaxRules*settings.RuleSize              // 796
	offEvalInterval = offInterval + 2                                                 // 798
	offTransfer     = offEvalInterval + 2                                             // 800
	offWiFi         = offTransfer + settings.TransferConfigSize                       // 816
	offConfigHash   = offWiFi + rp2040transport.WiFiSettingsSize                      // 1104
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
	binary.LittleEndian.PutUint16(buf[offEvalInterval:], s.Core.EvalIntervalSec)
	writeTransfer(buf, offTransfer, &s.Core.Transfer)
	wifiBytes := rp2040transport.EncodeWiFiSettings(s.WiFi)
	copy(buf[offWiFi:], wifiBytes)
	binary.LittleEndian.PutUint32(buf[offConfigHash:], s.Core.ConfigHash)

	return buf
}

func decodeSettings(buf []byte) rp2040Config {
	if len(buf) < offConfigHash+4 {
		return defaultConfig()
	}
	magic := binary.LittleEndian.Uint16(buf[0:])
	if magic != rp2040Magic || buf[2] != rp2040Version {
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
	c.WiFi = rp2040transport.DecodeWiFiSettings(buf[offWiFi:])
	if len(buf) >= offConfigHash+4 {
		c.Core.ConfigHash = binary.LittleEndian.Uint32(buf[offConfigHash:])
	}
	return c
}

func defaultConfig() rp2040Config {
	return rp2040Config{
		Core: settings.Defaults(),
		WiFi: rp2040transport.WiFiSettings{},
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
