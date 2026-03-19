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
	MaxFields   = 64 // shared between inputs, outputs, and computed fields
	MaxSensors  = 32
	MaxControls = 16
	MaxRules    = 16
	MaxStates   = 4
	MaxCompute  = 16 // max computed field expressions

	// SensorSlotSize is the binary wire size of a SensorSlot in flash.
	SensorSlotSize = 8

	// ControlSlotSize is the binary wire size of a ControlSlot in flash.
	ControlSlotSize = 8

	// SettingsSize is the flash page data size for codec purposes.
	SettingsSize = 1280

	// MaxExtraConditions is the number of compact condition slots per rule (C2-C4).
	MaxExtraConditions = 3
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
	PinPWM        PinFunction = 13 // PWM output (fan speed, LED dimmer)
	PinDAC        PinFunction = 14 // DAC analog output (STM32 only)
	PinMax        PinFunction = 15 // validation sentinel
)

func PinFunctionName(fn PinFunction) string {
	names := [...]string{
		"None", "Flow", "Relay", "Button", "ADC",
		"I2C_SDA", "I2C_SCL", "1Wire", "UART_TX", "UART_RX",
		"LED", "Counter", "RS485_DE", "PWM", "DAC",
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
	SensorDigitalIn    SensorType = 11 // Digital GPIO input; PinIndex=GPIO, Param1: 0=pullup 1=pulldown 2=float; output 0.0 or 1.0
	SensorTypeMax      SensorType = 12 // Sentinel for registry array sizing
)

// --- Slots ---

// SensorSlot occupies 8 bytes in flash.
type SensorSlot struct {
	Type       SensorType
	PinIndex   uint8  // GPIO pin index or bus instance index
	FieldIndex uint8  // first telemetry field index
	Flags      uint8  // bit 0: enabled, bit 1: inverted, bits 2-3: type-specific, bit 4: telemetry disabled, bit 5: on_change
	Param1     uint16 // type-specific
	Param2     uint16 // type-specific
}

func (s *SensorSlot) Enabled() bool             { return s.Flags&0x01 != 0 }
func (s *SensorSlot) Inverted() bool            { return s.Flags&0x02 != 0 }
func (s *SensorSlot) TelemetryDisabled() bool   { return s.Flags&0x10 != 0 }
func (s *SensorSlot) ReportOnChange() bool      { return s.Flags&0x20 != 0 }

// ActuatorType describes how a control output is driven.
type ActuatorType uint8

const (
	ActuatorRelay             ActuatorType = 0 // single pin, hold high/low
	ActuatorMotorizedValve    ActuatorType = 1 // dual-pin, timed pulse open/close
	ActuatorSolenoidMomentary ActuatorType = 2 // single pin, pulse then self-off
	ActuatorPWM               ActuatorType = 3 // single pin, PWM duty cycle 0-255
	ActuatorI2CPWM            ActuatorType = 4 // I2C bus-addressed PWM (e.g., PCA9685)
	ActuatorServo             ActuatorType = 5 // single pin, servo pulse 500-2500µs
	ActuatorDACLinear         ActuatorType = 6 // DAC analog output 0-255
)

// ControlSlot occupies 8 bytes in flash.
//
// Flash layout:
//
//	[0] PinIndex        — primary GPIO pin (or bus ordinal for I2C-addressed actuators)
//	[1] StateCount      — number of discrete states (0 = analog/continuous)
//	[2] Flags           — bit0=enabled, bit1=active-low, bit2=dual-pin
//	[3] ActuatorType    — 0=relay, 1=motorizedValve, 2=solenoid, 3=PWM, 4=I2CPWM, 5=servo, 6=DAC
//	[4] Pin2Index       — close-coil pin for motorized valve (0xFF = unused)
//	[5] PulseDurX100ms  — pulse duration × 100ms (0=hold, 20=2000ms)
//	[6] FieldIndex      — field index this control writes its state/value to
//	[7] ValueMax        — max output value (0=binary on/off, 255=8-bit PWM/DAC)
type ControlSlot struct {
	PinIndex       uint8
	StateCount     uint8
	Flags          uint8
	ActuatorType   ActuatorType
	Pin2Index      uint8
	PulseDurX100ms uint8
	FieldIndex     uint8
	ValueMax       uint8
}

func (c *ControlSlot) Enabled() bool   { return c.Flags&0x01 != 0 }
func (c *ControlSlot) ActiveLow() bool { return c.Flags&0x02 != 0 }
func (c *ControlSlot) DualPin() bool   { return c.Flags&0x04 != 0 }

// IsAnalog returns true for continuous-value output types (PWM, DAC, Servo, I2CPWM).
func (c *ControlSlot) IsAnalog() bool {
	return c.ActuatorType >= ActuatorPWM
}

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

// RuleSize is the binary wire size of a Rule in bytes (v4: 24 bytes).
const RuleSize = 24

// ExtraCondition is a compact condition slot (C2, C3, C4).
// Each occupies 3 bytes in the binary format.
type ExtraCondition struct {
	FieldIdx  uint8        // 0xFF = disabled
	Op        RuleOperator
	IsControl bool         // true: compare control state, false: compare sensor field
	Threshold uint8        // 0-255 integer threshold
}

// Rule represents an edge automation rule (v4: 4 conditions, 24 bytes).
//
// Binary layout:
//
//	[0]    ID
//	[1]    Flags: bit7=Enabled, bits6-4=Op(3), bit3=HasC2, bit2=HasC3, bit1=HasC4
//	[2]    FieldIdx (primary condition)
//	[3-6]  Threshold float32 LE (primary condition)
//	[7]    TargetFieldIdx — field to write to (output field → actuator fires)
//	[8]    ActionValue — value to write (0/1 for binary, 0-255 for analog/PWM)
//	[9-10] CooldownSec uint16 LE
//	[11]   Priority
//	[12]   ActionDurX10s
//	[13]   LogicOps: bits5-4=Logic12(2), bits3-2=Logic23(2), bits1-0=Logic34(2)
//	[14-16] C2: FieldIdx, OpFlags, Threshold
//	[17-19] C3: FieldIdx, OpFlags, Threshold
//	[20-22] C4: FieldIdx, OpFlags, Threshold
//	[23]   Reserved
type Rule struct {
	ID             uint8
	FieldIdx       uint8
	TargetFieldIdx uint8
	ActionValue    uint8
	Op             RuleOperator
	Priority    uint8
	CooldownSec uint16
	Threshold   float32
	Enabled     bool
	// action duration (0=hold indefinitely, 1-255 = ×10s, max ~42min).
	ActionDurX10s uint8
	// extra conditions (C2, C3, C4)
	HasC2, HasC3, HasC4 bool
	Logic12, Logic23, Logic34 uint8 // 0=AND, 1=OR
	Extra [MaxExtraConditions]ExtraCondition
}

// ActionDurationMs returns the action duration in milliseconds, or 0 for hold-indefinitely.
func (r *Rule) ActionDurationMs() uint32 {
	return uint32(r.ActionDurX10s) * 10_000
}

func (r *Rule) FromBinary(data []byte) bool {
	if len(data) < RuleSize {
		return false
	}
	r.ID = data[0]
	flags := data[1]
	r.Enabled = flags&0x80 != 0
	r.Op = RuleOperator((flags >> 4) & 0x07)
	r.HasC2 = flags&0x08 != 0
	r.HasC3 = flags&0x04 != 0
	r.HasC4 = flags&0x02 != 0
	r.FieldIdx = data[2]
	r.Threshold = math.Float32frombits(binary.LittleEndian.Uint32(data[3:7]))
	r.TargetFieldIdx = data[7]
	r.ActionValue = data[8]
	r.CooldownSec = binary.LittleEndian.Uint16(data[9:11])
	r.Priority = data[11]
	r.ActionDurX10s = data[12]
	logicOps := data[13]
	r.Logic12 = (logicOps >> 4) & 0x03
	r.Logic23 = (logicOps >> 2) & 0x03
	r.Logic34 = logicOps & 0x03
	// C2, C3, C4 — each 3 bytes starting at offset 14
	for i := 0; i < MaxExtraConditions; i++ {
		off := 14 + i*3
		r.Extra[i].FieldIdx = data[off]
		r.Extra[i].Op = RuleOperator((data[off+1] >> 5) & 0x07)
		r.Extra[i].IsControl = data[off+1]&0x10 != 0
		r.Extra[i].Threshold = data[off+2]
	}
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
	if r.HasC2 {
		buf[1] |= 0x08
	}
	if r.HasC3 {
		buf[1] |= 0x04
	}
	if r.HasC4 {
		buf[1] |= 0x02
	}
	buf[2] = r.FieldIdx
	binary.LittleEndian.PutUint32(buf[3:7], math.Float32bits(r.Threshold))
	buf[7] = r.TargetFieldIdx
	buf[8] = r.ActionValue
	binary.LittleEndian.PutUint16(buf[9:11], r.CooldownSec)
	buf[11] = r.Priority
	buf[12] = r.ActionDurX10s
	buf[13] = (r.Logic12&0x03)<<4 | (r.Logic23&0x03)<<2 | (r.Logic34 & 0x03)
	// C2, C3, C4
	for i := 0; i < MaxExtraConditions; i++ {
		off := 14 + i*3
		buf[off] = r.Extra[i].FieldIdx
		buf[off+1] = (uint8(r.Extra[i].Op) & 0x07) << 5
		if r.Extra[i].IsControl {
			buf[off+1] |= 0x10
		}
		buf[off+2] = r.Extra[i].Threshold
	}
	buf[23] = 0 // reserved
	return RuleSize
}

// --- Compute fields ---

// MaxBytecodeLen is the maximum bytecode length per compute expression.
const MaxBytecodeLen = 64

// ComputeSlot defines a computed field expression evaluated every compute cycle.
type ComputeSlot struct {
	FieldIdx    uint8  // target field index in the values array
	BytecodeLen uint8  // length of bytecode program
	Bytecode    [MaxBytecodeLen]byte
}

// ComputeOpcode defines bytecode VM operations.
type ComputeOpcode uint8

const (
	OpLoadField ComputeOpcode = 0x01 // push values[arg]
	OpPushF32   ComputeOpcode = 0x02 // push float32 constant (4 bytes follow)
	OpAdd       ComputeOpcode = 0x10
	OpSub       ComputeOpcode = 0x11
	OpMul       ComputeOpcode = 0x12
	OpDiv       ComputeOpcode = 0x13
	OpCmpGT     ComputeOpcode = 0x20 // a > b → 1.0 or 0.0
	OpCmpLT     ComputeOpcode = 0x21
	OpCmpGTE    ComputeOpcode = 0x22
	OpCmpLTE    ComputeOpcode = 0x23
	OpMin2      ComputeOpcode = 0x30
	OpMax2      ComputeOpcode = 0x31
	OpAbs       ComputeOpcode = 0x32
	OpNeg       ComputeOpcode = 0x33
	OpAccum     ComputeOpcode = 0x40 // running sum (persistent state)
	OpWindowAvg ComputeOpcode = 0x41 // rolling average; next byte = window size N
	OpClamp     ComputeOpcode = 0x42 // clamp; next 8 bytes = min(f32) max(f32)
)

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

	ComputeCount uint8
	Compute      [MaxCompute]ComputeSlot

	TxIntervalSec   uint16
	EvalIntervalSec uint16 // rule evaluation interval; 0 = same as TxIntervalSec

	Transfer TransferConfig // v2+; zero value = disabled

	// ConfigHash is the last AirConfig hash committed to flash via AirCfgSetHash (0x09).
	// Reported in checkin (fPort 1) so the backend can detect config drift.
	// Zero means "unknown" — backend will always push config on first checkin.
	ConfigHash uint32
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
