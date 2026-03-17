// Package settings provides Tasmota-inspired runtime device configuration.
// The core device personality (pins, sensors, controls, rules, tx interval)
// lives in CoreSettings. Transport-specific config (LoRaWAN, WiFi) is defined
// here as separate structs and owned by each device target's codec.
package settings

import (
	"encoding/binary"
	"math"
)

const (
	MaxPins     = 20
	MaxSensors  = 8
	MaxControls = 8
	MaxRules    = 32
	MaxStates   = 4

	// SettingsSize is the flash page data size for codec purposes.
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
	PinUARTTX     PinFunction = 8  // RS485/Modbus TX
	PinUARTRX     PinFunction = 9  // RS485/Modbus RX
	PinLED        PinFunction = 10
	PinCounter    PinFunction = 11 // generic pulse counter
	PinRS485DE    PinFunction = 12 // RS485 direction-enable (DE/RE) for Modbus transceivers
	PinMax        PinFunction = 13 // validation sentinel
)

func PinFunctionName(fn PinFunction) string {
	names := [...]string{
		"None", "Flow", "Relay", "Button", "ADC",
		"I2C_SDA", "I2C_SCL", "1Wire", "UART_TX", "UART_RX",
		"LED", "Counter", "RS485_DE",
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
	SensorFlowYFS201 SensorType = 1 // YF-S201 pulse flow; Param1=pulses/liter
	SensorBatteryADC SensorType = 2 // LiPo battery ADC; hardcoded 3.0-4.2V curve
	SensorDS18B20    SensorType = 3 // 1-Wire temp; PinIndex=GPIO, Param1=sensor idx on bus
	SensorSoilADC    SensorType = 4 // Capacitive soil; Param1=dryRaw, Param2=wetRaw → output 0-100%
	SensorBME280     SensorType = 5 // I2C BME280; PinIndex=bus idx, Param1 lo=I2C addr; 3 fields
	SensorINA219     SensorType = 6 // I2C INA219; PinIndex=bus idx, Param1 lo=I2C addr; 3 fields
	// Interface-level generic drivers (configurable via Param1+Param2 calibration)
	SensorADCLinear    SensorType = 7  // Any linear 0-VREF ADC; Param1=offset×10, Param2=span×10
	SensorADC4_20mA    SensorType = 8  // 4-20mA current loop (250Ω shunt); Param1=offset×10, Param2=span×10
	SensorPulseGeneric SensorType = 9  // Generic pulse counter; Param1=pulses/unit
	SensorModbusRTU    SensorType = 10 // Modbus RTU over RS485; PinIndex=UART bus idx, Param1=devAddr|funcCode, Param2=regAddr
	SensorTypeMax      SensorType = 11 // Sentinel for registry array sizing
)

// --- Slots ---

// SensorSlot occupies 8 bytes in flash.
// Param1 and Param2 semantics are sensor-type-specific — see SensorType constants.
type SensorSlot struct {
	Type       SensorType
	PinIndex   uint8  // GPIO pin index (GPIO sensors) or bus instance index (I2C/UART sensors)
	FieldIndex uint8  // first telemetry field index; multi-field sensors use FieldIndex+1, +2, etc.
	Flags      uint8  // bit 0: enabled, bit 1: inverted
	Param1     uint16 // type-specific: pulses/liter, I2C addr, calib offset×10, Modbus devAddr|funcCode
	Param2     uint16 // type-specific: wetRaw, calib span×10, Modbus register address
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

// --- Rules ---

type RuleOperator uint8

const (
	OpLT  RuleOperator = 0
	OpGT  RuleOperator = 1
	OpLTE RuleOperator = 2
	OpGTE RuleOperator = 3
	OpEQ  RuleOperator = 4
	OpNEQ RuleOperator = 5
)

// RuleSize is the binary wire size of a Rule in bytes.
const RuleSize = 16

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
	// compound condition
	HasSecond       bool
	LogicOR         bool        // false=AND, true=OR
	SecondFieldIdx  uint8       // 0xFF = no second condition
	SecondOp        RuleOperator
	SecondIsControl bool        // true: compare control state, false: compare sensor field
	SecondThreshold uint8       // 0-255 integer threshold
	// time window (1.5h granularity, 0=no restriction)
	TimeStart uint8 // 0-15, maps to hour via *1.5
	TimeEnd   uint8 // 0-15, maps to hour via *1.5
}

// TimeStartHour returns the decoded start hour (0.0-22.5), or -1 if no time window.
func (r *Rule) TimeStartHour() float32 {
	if r.TimeStart == 0 && r.TimeEnd == 0 {
		return -1
	}
	return float32(r.TimeStart) * 1.5
}

// TimeEndHour returns the decoded end hour (0.0-22.5), or -1 if no time window.
func (r *Rule) TimeEndHour() float32 {
	if r.TimeStart == 0 && r.TimeEnd == 0 {
		return -1
	}
	return float32(r.TimeEnd) * 1.5
}

func (r *Rule) FromBinary(data []byte) bool {
	if len(data) < RuleSize {
		return false
	}
	r.ID = data[0]
	r.Enabled = data[1]&0x80 != 0
	r.HasSecond = data[1]&0x08 != 0
	r.LogicOR = data[1]&0x04 != 0
	r.Op = RuleOperator((data[1] >> 4) & 0x07)
	r.FieldIdx = data[2]
	r.Threshold = math.Float32frombits(binary.LittleEndian.Uint32(data[3:7]))
	r.ControlIdx = data[7]
	r.ActionState = data[8]
	r.CooldownSec = binary.LittleEndian.Uint16(data[9:11])
	r.Priority = data[11]
	r.SecondFieldIdx = data[12]
	r.SecondOp = RuleOperator((data[13] >> 4) & 0x07)
	r.SecondIsControl = data[13]&0x08 != 0
	r.SecondThreshold = data[14]
	r.TimeStart = (data[15] >> 4) & 0x0F
	r.TimeEnd = data[15] & 0x0F
	return true
}

func (r *Rule) ToBinary(buf []byte) int {
	if len(buf) < RuleSize {
		return 0
	}
	buf[0] = r.ID
	buf[1] = (uint8(r.Op) & 0x07) << 4
	if r.Enabled {
		buf[1] |= 0x80
	}
	if r.HasSecond {
		buf[1] |= 0x08
	}
	if r.LogicOR {
		buf[1] |= 0x04
	}
	buf[2] = r.FieldIdx
	binary.LittleEndian.PutUint32(buf[3:7], math.Float32bits(r.Threshold))
	buf[7] = r.ControlIdx
	buf[8] = r.ActionState
	binary.LittleEndian.PutUint16(buf[9:11], r.CooldownSec)
	buf[11] = r.Priority
	buf[12] = r.SecondFieldIdx
	buf[13] = (uint8(r.SecondOp) & 0x07) << 4
	if r.SecondIsControl {
		buf[13] |= 0x08
	}
	buf[14] = r.SecondThreshold
	buf[15] = (r.TimeStart&0x0F)<<4 | (r.TimeEnd & 0x0F)
	return RuleSize
}

// --- LoRaWAN settings (used by LoRa-E5 target codec; not in CoreSettings) ---

// LoRaWANSettings holds LoRaWAN transport configuration. It is stored in flash
// immediately after the CoreSettings block in the LoRa-E5 codec.
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

// LoRaWANDefaults returns the default LoRaWAN configuration.
func LoRaWANDefaults() LoRaWANSettings {
	return LoRaWANSettings{
		Region:     0, // US915
		SubBand:    2,
		DataRate:   3,
		TxPower:    22,
		ADREnabled: true,
		Confirmed:  true,
	}
}

// --- CoreSettings (the whole device config, transport-agnostic) ---

// CoreSettings holds all device configuration that is independent of transport.
// Magic word, version byte, and CRC16 are flash header fields managed by each
// target's codec — they are NOT stored in this struct.
type CoreSettings struct {
	PinMap [MaxPins]PinFunction

	SensorCount uint8
	Sensors     [MaxSensors]SensorSlot

	ControlCount uint8
	Controls     [MaxControls]ControlSlot

	RuleCount uint8
	Rules     [MaxRules]Rule

	TxIntervalSec uint16
}

// --- Presets (like Tasmota modules — const, selectable at runtime) ---

type Preset uint8

const (
	PresetGeneric      Preset = 0
	PresetWaterMonitor Preset = 1
	PresetSoilStation  Preset = 2
)

// Defaults returns a CoreSettings with safe default values.
// LoRaWAN defaults are separate — see LoRaWANDefaults().
func Defaults() CoreSettings {
	return CoreSettings{
		TxIntervalSec: 60,
	}
}

func ApplyPreset(p Preset) CoreSettings {
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
		s.Sensors[0] = SensorSlot{SensorFlowYFS201, 3, 0, 0x01, 450, 0}
		s.Sensors[1] = SensorSlot{SensorBatteryADC, 8, 2, 0x01, 0, 0}

		s.ControlCount = 2
		s.Controls[0] = ControlSlot{PinIndex: 6, StateCount: 2, Flags: 0x01}
		s.Controls[1] = ControlSlot{PinIndex: 7, StateCount: 2, Flags: 0x01}

	case PresetSoilStation:
		s.PinMap[3] = PinADC     // PA3 -> soil moisture
		s.PinMap[4] = PinOneWire // PA4 -> DS18B20
		s.PinMap[6] = PinRelay   // PA6 -> irrigation valve
		s.PinMap[8] = PinADC     // PB0 -> battery
		s.PinMap[14] = PinI2CSDA // PA15 -> OLED
		s.PinMap[15] = PinI2CSCL // PB15 -> OLED

		s.SensorCount = 2
		// SoilADC: Param1=dryRaw(~55000), Param2=wetRaw(~18000) — calibrate per sensor
		s.Sensors[0] = SensorSlot{SensorSoilADC, 3, 0, 0x01, 55000, 18000}
		s.Sensors[1] = SensorSlot{SensorBatteryADC, 8, 2, 0x01, 0, 0}

		s.ControlCount = 1
		s.Controls[0] = ControlSlot{PinIndex: 6, StateCount: 2, Flags: 0x01}

	case PresetGeneric:
		// all pins None, user configures everything via AirConfig
	}

	return s
}
