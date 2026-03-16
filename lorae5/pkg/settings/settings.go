// Package settings provides Tasmota-inspired runtime device configuration.
// The entire device personality (pins, sensors, controls, rules, LoRaWAN params)
// lives in a single struct persisted to flash. Changeable via AirConfig downlinks.
package settings

import (
	"encoding/binary"
	"math"
)

const (
	Magic        = 0xFA12
	Version      = 1
	MaxPins      = 20
	MaxSensors   = 8
	MaxControls  = 8
	MaxRules     = 32
	MaxStates    = 4
	SettingsSize = 1024
)

// --- Pin functions (Tasmota-style GPIO role assignment) ---

type PinFunction uint8

const (
	PinNone       PinFunction = 0
	PinFlowSensor PinFunction = 1  // pulse counter via interrupt
	PinRelay      PinFunction = 2  // digital output (pump, valve)
	PinButton     PinFunction = 3  // digital input
	PinADC        PinFunction = 4  // analog read (battery, soil)
	PinI2CSDA     PinFunction = 5
	PinI2CSCL     PinFunction = 6
	PinOneWire    PinFunction = 7  // DS18B20
	PinUARTTX     PinFunction = 8  // RS485/Modbus
	PinUARTRX     PinFunction = 9
	PinLED        PinFunction = 10
	PinCounter    PinFunction = 11 // generic pulse counter
	PinMax        PinFunction = 12 // validation sentinel
)

func PinFunctionName(fn PinFunction) string {
	names := [...]string{
		"None", "Flow", "Relay", "Button", "ADC",
		"I2C_SDA", "I2C_SCL", "1Wire", "UART_TX", "UART_RX",
		"LED", "Counter",
	}
	if int(fn) < len(names) {
		return names[fn]
	}
	return "?"
}

// --- Sensor types (compiled-in drivers, activated by config) ---

type SensorType uint8

const (
	SensorNone       SensorType = 0
	SensorFlowYFS201 SensorType = 1
	SensorBatteryADC SensorType = 2
	SensorDS18B20    SensorType = 3
	SensorSoilADC    SensorType = 4
	SensorBME280     SensorType = 5
	SensorINA219     SensorType = 6
)

// --- Slots ---

type SensorSlot struct {
	Type       SensorType
	PinIndex   uint8
	FieldIndex uint8
	Flags      uint8  // bit 0: enabled, bit 1: inverted
	Param1     uint16 // sensor-specific (e.g. pulses_per_liter)
}

func (s *SensorSlot) Enabled() bool  { return s.Flags&0x01 != 0 }
func (s *SensorSlot) Inverted() bool { return s.Flags&0x02 != 0 }

type ControlSlot struct {
	PinIndex   uint8
	StateCount uint8
	Flags      uint8 // bit 0: enabled, bit 1: active-low
}

func (c *ControlSlot) Enabled() bool   { return c.Flags&0x01 != 0 }
func (c *ControlSlot) ActiveLow() bool { return c.Flags&0x02 != 0 }

// --- Rules (12-byte binary, wire-compatible with C++ edge_rules.h) ---

type RuleOperator uint8

const (
	OpLT  RuleOperator = 0
	OpGT  RuleOperator = 1
	OpLTE RuleOperator = 2
	OpGTE RuleOperator = 3
	OpEQ  RuleOperator = 4
	OpNEQ RuleOperator = 5
)

type Rule struct {
	ID          uint8
	FieldIdx    uint8
	ControlIdx  uint8
	ActionState uint8
	Op          RuleOperator
	Priority    uint8
	CooldownSec uint16
	Threshold   float32
	Enabled     bool
}

func (r *Rule) FromBinary(data []byte) bool {
	if len(data) < 12 {
		return false
	}
	r.ID = data[0]
	r.Enabled = data[1]&0x80 != 0
	r.Op = RuleOperator((data[1] >> 4) & 0x07)
	r.FieldIdx = data[2]
	r.Threshold = math.Float32frombits(binary.LittleEndian.Uint32(data[3:7]))
	r.ControlIdx = data[7]
	r.ActionState = data[8]
	r.CooldownSec = binary.LittleEndian.Uint16(data[9:11])
	r.Priority = data[11]
	return true
}

func (r *Rule) ToBinary(buf []byte) int {
	if len(buf) < 12 {
		return 0
	}
	buf[0] = r.ID
	buf[1] = (uint8(r.Op) & 0x07) << 4
	if r.Enabled {
		buf[1] |= 0x80
	}
	buf[2] = r.FieldIdx
	binary.LittleEndian.PutUint32(buf[3:7], math.Float32bits(r.Threshold))
	buf[7] = r.ControlIdx
	buf[8] = r.ActionState
	binary.LittleEndian.PutUint16(buf[9:11], r.CooldownSec)
	buf[11] = r.Priority
	return 12
}

// --- LoRaWAN ---

type LoRaWANSettings struct {
	Region     uint8 // 0=US915, 1=EU868, 2=AU915, 3=AS923
	SubBand    uint8
	DataRate   uint8
	TxPower    uint8
	ADREnabled bool
	Confirmed  bool
	AppEUI     [8]byte
	AppKey     [16]byte
}

// --- Device settings (the whole config, persisted to flash) ---

type DeviceSettings struct {
	MagicWord uint16
	Version   uint8
	CRC16     uint16

	PinMap [MaxPins]PinFunction

	SensorCount uint8
	Sensors     [MaxSensors]SensorSlot

	ControlCount uint8
	Controls     [MaxControls]ControlSlot

	RuleCount uint8
	Rules     [MaxRules]Rule

	LoRaWAN LoRaWANSettings

	TxIntervalSec uint16
}

// --- Presets (like Tasmota modules — const, selectable at runtime) ---

type Preset uint8

const (
	PresetGeneric      Preset = 0
	PresetWaterMonitor Preset = 1
	PresetSoilStation  Preset = 2
)

func Defaults() DeviceSettings {
	return DeviceSettings{
		MagicWord:     Magic,
		Version:       Version,
		TxIntervalSec: 60,
		LoRaWAN: LoRaWANSettings{
			Region:     0, // US915
			SubBand:    2,
			DataRate:   3,
			TxPower:    22,
			ADREnabled: true,
			Confirmed:  true,
		},
	}
}

func ApplyPreset(p Preset) DeviceSettings {
	s := Defaults()

	switch p {
	case PresetWaterMonitor:
		s.PinMap[3] = PinFlowSensor // PA3
		s.PinMap[6] = PinRelay      // PA6 -> pump
		s.PinMap[7] = PinRelay      // PA7 -> valve
		s.PinMap[8] = PinADC        // PB0 -> battery
		s.PinMap[14] = PinI2CSDA    // PA15 -> OLED
		s.PinMap[15] = PinI2CSCL    // PB15 -> OLED

		s.SensorCount = 2
		s.Sensors[0] = SensorSlot{SensorFlowYFS201, 3, 0, 0x01, 450}
		s.Sensors[1] = SensorSlot{SensorBatteryADC, 8, 2, 0x01, 0}

		s.ControlCount = 2
		s.Controls[0] = ControlSlot{PinIndex: 6, StateCount: 2, Flags: 0x01}
		s.Controls[1] = ControlSlot{PinIndex: 7, StateCount: 2, Flags: 0x01}

	case PresetSoilStation:
		s.PinMap[3] = PinADC        // PA3 -> soil moisture
		s.PinMap[4] = PinOneWire    // PA4 -> DS18B20
		s.PinMap[6] = PinRelay      // PA6 -> irrigation valve
		s.PinMap[8] = PinADC        // PB0 -> battery
		s.PinMap[14] = PinI2CSDA    // PA15 -> OLED
		s.PinMap[15] = PinI2CSCL    // PB15 -> OLED

		s.SensorCount = 2
		s.Sensors[0] = SensorSlot{SensorSoilADC, 3, 0, 0x01, 0}
		s.Sensors[1] = SensorSlot{SensorBatteryADC, 8, 2, 0x01, 0}

		s.ControlCount = 1
		s.Controls[0] = ControlSlot{PinIndex: 6, StateCount: 2, Flags: 0x01}

	case PresetGeneric:
		// all pins None, user configures everything via AirConfig
	}

	return s
}
