// Package settings provides runtime device configuration.
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

// --- Pin functions ---

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

// --- Sensor types ---

type SensorType uint8

const (
	SensorNone       SensorType = 0
	SensorFlowYFS201 SensorType = 1 // YF-S201 pulse flow; Param1=pulses/liter
	SensorBatteryADC SensorType = 2 // LiPo battery ADC; hardcoded 3.0-4.2V curve
	SensorDS18B20    SensorType = 3 // 1-Wire temp; PinIndex=GPIO, Param1=sensor idx on bus
	SensorSoilADC    SensorType = 4 // Capacitive soil; Param1=dryRaw, Param2=wetRaw → output 0-100%
	SensorBME280     SensorType = 5 // I2C BME280; PinIndex=bus idx, Param1 lo=I2C addr; 3 fields
	SensorINA219     SensorType = 6 // I2C INA219; PinIndex=bus idx, Param1 lo=I2C addr; 3 fields
	SensorADCLinear    SensorType = 7  // Any linear 0-VREF ADC; Param1=offset×10, Param2=span×10
	SensorADC4_20mA    SensorType = 8  // 4-20mA current loop (250Ω shunt); Param1=offset×10, Param2=span×10
	SensorPulseGeneric SensorType = 9  // Generic pulse counter; Param1=pulses/unit
	SensorModbusRTU    SensorType = 10 // Modbus RTU over RS485; PinIndex=UART bus idx, Param1=devAddr|funcCode, Param2=regAddr
	SensorTypeMax      SensorType = 11 // Sentinel for registry array sizing
)

// --- Slots ---

// SensorSlot occupies 8 bytes in flash.
type SensorSlot struct {
	Type       SensorType
	PinIndex   uint8  // GPIO pin index or bus instance index
	FieldIndex uint8  // first telemetry field index
	Flags      uint8  // bit 0: enabled, bit 1: inverted
	Param1     uint16 // type-specific
	Param2     uint16 // type-specific
}

func (s *SensorSlot) Enabled() bool  { return s.Flags&0x01 != 0 }
func (s *SensorSlot) Inverted() bool { return s.Flags&0x02 != 0 }

// ActuatorType describes how a control output is driven.
type ActuatorType uint8

const (
	ActuatorRelay             ActuatorType = 0 // single pin, hold high/low
	ActuatorMotorizedValve    ActuatorType = 1 // dual-pin, timed pulse open/close
	ActuatorSolenoidMomentary ActuatorType = 2 // single pin, pulse then self-off
)

// ControlSlot occupies 8 bytes in flash (v2+).
//
// Flash layout:
//   [0] PinIndex        — primary pin (open-coil for motorized valve)
//   [1] StateCount      — number of states (typically 2: off/on)
//   [2] Flags           — bit0=enabled, bit1=active-low, bit2=dual-pin, bit3=momentary
//   [3] ActuatorType    — 0=relay, 1=motorizedValve, 2=solenoidMomentary
//   [4] Pin2Index       — close-coil pin for motorized valve (0xFF = unused)
//   [5] PulseDurX100ms  — pulse duration × 100ms (0=hold, 20=2000ms)
//   [6] Reserved
//   [7] Reserved
type ControlSlot struct {
	PinIndex       uint8
	StateCount     uint8
	Flags          uint8
	ActuatorType   ActuatorType
	Pin2Index      uint8
	PulseDurX100ms uint8
	Reserved       [2]uint8
}

func (c *ControlSlot) Enabled() bool   { return c.Flags&0x01 != 0 }
func (c *ControlSlot) ActiveLow() bool { return c.Flags&0x02 != 0 }
func (c *ControlSlot) DualPin() bool   { return c.Flags&0x04 != 0 }
func (c *ControlSlot) Momentary() bool { return c.Flags&0x08 != 0 }

// ControlSlotSize is the binary wire size of a ControlSlot in flash.
const ControlSlotSize = 8

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

// --- LoRaWAN settings ---

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

// --- TransferConfig: autonomous water transfer FSM parameters ---

// TransferConfig occupies 16 bytes in flash (v2+).
//
// Flash layout:
//   [0]    Enabled           — 0=disabled
//   [1]    PumpCtrlIdx       — control slot index for the pump
//   [2]    ValveT1CtrlIdx    — motorized valve: Tank1 → shared pipe
//   [3]    ValveT2CtrlIdx    — motorized valve: Tank2 → shared pipe
//   [4]    SVCtrlIdx         — solenoid valve (pressure equalization)
//   [5]    LevelT1FieldIdx   — sensor field index for Tank1 level
//   [6]    LevelT2FieldIdx   — sensor field index for Tank2 level
//   [7]    StartDeltaPct     — start transfer when T1-T2 > N% (default 20)
//   [8]    StopT1MinPct      — stop when T1 < N% (default 15)
//   [9]    MeasurePulseSec   — solenoid pulse duration in seconds (default 2)
//   [10]   Flags
//   [11-15] Reserved
type TransferConfig struct {
	Enabled         uint8
	PumpCtrlIdx     uint8
	ValveT1CtrlIdx  uint8
	ValveT2CtrlIdx  uint8
	SVCtrlIdx       uint8
	LevelT1FieldIdx uint8
	LevelT2FieldIdx uint8
	StartDeltaPct   uint8
	StopT1MinPct    uint8
	MeasurePulseSec uint8
	Flags           uint8
	Reserved        [5]uint8
}

// TransferConfigSize is the binary size of TransferConfig in flash.
const TransferConfigSize = 16

func TransferDefaults() TransferConfig {
	return TransferConfig{
		StartDeltaPct:   20,
		StopT1MinPct:    15,
		MeasurePulseSec: 2,
	}
}

// --- CoreSettings ---

// CoreSettings holds all device configuration independent of transport.
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

	Transfer TransferConfig // v2+; zero value = disabled
}

// --- Presets ---

type Preset uint8

const (
	PresetGeneric      Preset = 0
	PresetWaterMonitor Preset = 1
	PresetSoilStation  Preset = 2
	PresetWaterManager Preset = 3 // 2-tank autonomous transfer system
)

func Defaults() CoreSettings {
	return CoreSettings{
		TxIntervalSec: 60,
		Transfer:      TransferDefaults(),
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
		s.Sensors[0] = SensorSlot{SensorSoilADC, 3, 0, 0x01, 55000, 18000}
		s.Sensors[1] = SensorSlot{SensorBatteryADC, 8, 2, 0x01, 0, 0}

		s.ControlCount = 1
		s.Controls[0] = ControlSlot{PinIndex: 6, StateCount: 2, Flags: 0x01}

	case PresetWaterManager:
		// 2-tank autonomous water transfer system.
		// Controls:
		//   0 = Pump          (relay, GP6)
		//   1 = Valve T1      (motorized, open=GP7 close=GP8, 5s pulse)
		//   2 = Valve T2      (motorized, open=GP9 close=GP10, 5s pulse)
		//   3 = Flow Valve T1 (relay, GP11 — outlet from Tank1 side)
		//   4 = Flow Valve T2 (relay, GP12 — outlet from Tank2 side)
		//   5 = Solenoid SV   (momentary, GP13, 2s pulse)
		// Sensors:
		//   0 = Pressure/Level (4-20mA, field 0)
		//   1 = Flow T1        (YF-S201, field 1)
		//   2 = Flow T2        (YF-S201, field 2)
		//   3 = Battery ADC    (field 3)
		s.SensorCount = 4
		s.Sensors[0] = SensorSlot{SensorADC4_20mA, 3, 0, 0x01, 0, 1000}     // 4-20mA level
		s.Sensors[1] = SensorSlot{SensorFlowYFS201, 4, 1, 0x01, 450, 0}      // flow T1
		s.Sensors[2] = SensorSlot{SensorFlowYFS201, 5, 2, 0x01, 450, 0}      // flow T2
		s.Sensors[3] = SensorSlot{SensorBatteryADC, 8, 3, 0x01, 0, 0}        // battery

		s.ControlCount = 6
		// Pump: simple relay
		s.Controls[0] = ControlSlot{PinIndex: 6, StateCount: 2, Flags: 0x01,
			ActuatorType: ActuatorRelay}
		// Valve T1: motorized, dual-pin, 5s pulse (50 × 100ms)
		s.Controls[1] = ControlSlot{PinIndex: 7, StateCount: 2, Flags: 0x05,
			ActuatorType: ActuatorMotorizedValve, Pin2Index: 8, PulseDurX100ms: 50}
		// Valve T2: motorized, dual-pin, 5s pulse
		s.Controls[2] = ControlSlot{PinIndex: 9, StateCount: 2, Flags: 0x05,
			ActuatorType: ActuatorMotorizedValve, Pin2Index: 10, PulseDurX100ms: 50}
		// Flow Valve T1: simple relay
		s.Controls[3] = ControlSlot{PinIndex: 11, StateCount: 2, Flags: 0x01,
			ActuatorType: ActuatorRelay}
		// Flow Valve T2: simple relay
		s.Controls[4] = ControlSlot{PinIndex: 12, StateCount: 2, Flags: 0x01,
			ActuatorType: ActuatorRelay}
		// Solenoid SV: momentary, 2s pulse (20 × 100ms)
		s.Controls[5] = ControlSlot{PinIndex: 13, StateCount: 2, Flags: 0x09,
			ActuatorType: ActuatorSolenoidMomentary, PulseDurX100ms: 20}

		// Pin map for WaterManager preset
		s.PinMap[3] = PinADC        // 4-20mA level sensor
		s.PinMap[4] = PinFlowSensor // flow T1
		s.PinMap[5] = PinFlowSensor // flow T2
		s.PinMap[6] = PinRelay      // pump
		s.PinMap[7] = PinRelay      // valve T1 open
		s.PinMap[8] = PinRelay      // valve T1 close
		s.PinMap[9] = PinRelay      // valve T2 open
		s.PinMap[10] = PinRelay     // valve T2 close
		s.PinMap[11] = PinRelay     // flow valve T1
		s.PinMap[12] = PinRelay     // flow valve T2
		s.PinMap[13] = PinRelay     // solenoid SV
		s.PinMap[14] = PinADC       // battery

		// Transfer FSM defaults (enabled)
		s.Transfer = TransferConfig{
			Enabled:         1,
			PumpCtrlIdx:     0,
			ValveT1CtrlIdx:  1,
			ValveT2CtrlIdx:  2,
			SVCtrlIdx:       5,
			LevelT1FieldIdx: 0,
			LevelT2FieldIdx: 0, // same sensor, valve switches which tank is measured
			StartDeltaPct:   20,
			StopT1MinPct:    15,
			MeasurePulseSec: 2,
		}

	case PresetGeneric:
		// all pins None, user configures everything via AirConfig
	}

	return s
}
