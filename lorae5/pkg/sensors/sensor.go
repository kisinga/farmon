// Package sensors provides runtime-configurable sensor drivers.
// Drivers are compiled in and activated by settings (Tasmota pattern).
package sensors

import "machine"

// Reading is a single sensor measurement.
type Reading struct {
	FieldIndex uint8
	Value      float32
	Valid      bool
}

// Driver is the interface all sensor drivers implement.
type Driver interface {
	Begin()
	Read() []Reading
	Name() string
}

// --- YF-S201 Water Flow Sensor (interrupt-driven pulse counting) ---

type FlowSensor struct {
	pin            machine.Pin
	fieldIdx       uint8
	pulsesPerLiter uint16
	pulseCount     volatile32
	totalPulses    uint32
}

// volatile32 is a simple wrapper since TinyGo doesn't have atomic on all targets.
type volatile32 struct {
	val uint32
}

func NewFlowSensor(pin machine.Pin, fieldIdx uint8, pulsesPerLiter uint16) *FlowSensor {
	return &FlowSensor{
		pin:            pin,
		fieldIdx:       fieldIdx,
		pulsesPerLiter: pulsesPerLiter,
	}
}

func (f *FlowSensor) Begin() {
	f.pin.Configure(machine.PinConfig{Mode: machine.PinInputPullup})
	f.pin.SetInterrupt(machine.PinFalling, func(p machine.Pin) {
		f.pulseCount.val++
	})
}

func (f *FlowSensor) Read() []Reading {
	// Grab and reset pulse count (disable interrupts briefly)
	count := f.pulseCount.val
	f.pulseCount.val = 0

	f.totalPulses += count
	volume := float32(f.totalPulses) / float32(f.pulsesPerLiter)

	return []Reading{
		{FieldIndex: f.fieldIdx, Value: float32(count), Valid: true},     // pulse delta
		{FieldIndex: f.fieldIdx + 1, Value: volume, Valid: true},         // total volume
	}
}

func (f *FlowSensor) Name() string        { return "YFS201" }
func (f *FlowSensor) TotalPulses() uint32 { return f.totalPulses }
func (f *FlowSensor) SetTotalPulses(v uint32) { f.totalPulses = v }

// --- Battery ADC Sensor ---

type BatteryADC struct {
	pin      machine.Pin
	adc      machine.ADC
	fieldIdx uint8
}

func NewBatteryADC(pin machine.Pin, fieldIdx uint8) *BatteryADC {
	return &BatteryADC{pin: pin, fieldIdx: fieldIdx}
}

func (b *BatteryADC) Begin() {
	b.adc = machine.ADC{Pin: b.pin}
	b.adc.Configure(machine.ADCConfig{})
}

func (b *BatteryADC) Read() []Reading {
	raw := b.adc.Get()
	// Convert 16-bit ADC to voltage (3.3V ref, voltage divider 2:1)
	voltage := float32(raw) / 65535.0 * 3.3 * 2.0
	// Map voltage to percentage (3.0V-4.2V for LiPo)
	pct := (voltage - 3.0) / (4.2 - 3.0) * 100.0
	if pct < 0 {
		pct = 0
	}
	if pct > 100 {
		pct = 100
	}
	return []Reading{
		{FieldIndex: b.fieldIdx, Value: pct, Valid: true},
	}
}

func (b *BatteryADC) Name() string { return "BatteryADC" }
