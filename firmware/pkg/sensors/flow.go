//go:build !esp32s3

package sensors

import "machine"

// FlowSensor measures liquid flow using a YF-S201-style pulse meter.
// Param1 = pulses per litre (default 450).
// Outputs: pulse delta (fieldIdx), cumulative volume in litres (fieldIdx+1).

type FlowSensor struct {
	pulseCounter
	fieldIdx       uint8
	pulsesPerLiter uint16
}

func NewFlowSensor(pin machine.Pin, fieldIdx uint8, pulsesPerLiter uint16) *FlowSensor {
	return &FlowSensor{
		pulseCounter:   pulseCounter{pin: pin},
		fieldIdx:       fieldIdx,
		pulsesPerLiter: pulsesPerLiter,
	}
}

func (f *FlowSensor) Begin() { f.pulseCounter.begin() }

func (f *FlowSensor) Read() []Reading {
	delta := f.consume()
	volume := float32(f.total) / float32(f.pulsesPerLiter)
	return []Reading{
		{FieldIndex: f.fieldIdx, Value: float32(delta), Valid: true},
		{FieldIndex: f.fieldIdx + 1, Value: volume, Valid: true},
	}
}

func (f *FlowSensor) Name() string           { return "YFS201" }
func (f *FlowSensor) TotalPulses() uint32     { return f.total }
func (f *FlowSensor) SetTotalPulses(v uint32) { f.total = v }
