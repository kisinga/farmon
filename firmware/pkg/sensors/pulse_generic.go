package sensors

import "machine"

// PulseGenericSensor counts falling-edge pulses on any GPIO pin.
// Param1 = pulses per output unit (default 1).
// Outputs: unit delta (fieldIdx), cumulative unit total (fieldIdx+1).

type PulseGenericSensor struct {
	pulseCounter
	fieldIdx      uint8
	pulsesPerUnit uint16
}

func NewPulseGenericSensor(pin machine.Pin, fieldIdx uint8, pulsesPerUnit uint16) *PulseGenericSensor {
	if pulsesPerUnit == 0 {
		pulsesPerUnit = 1
	}
	return &PulseGenericSensor{
		pulseCounter:  pulseCounter{pin: pin},
		fieldIdx:      fieldIdx,
		pulsesPerUnit: pulsesPerUnit,
	}
}

func (p *PulseGenericSensor) Begin() { p.pulseCounter.begin() }

func (p *PulseGenericSensor) Read() []Reading {
	delta := p.consume()
	unitDelta := float32(delta) / float32(p.pulsesPerUnit)
	unitTotal := float32(p.total) / float32(p.pulsesPerUnit)
	return []Reading{
		{FieldIndex: p.fieldIdx, Value: unitDelta, Valid: true},
		{FieldIndex: p.fieldIdx + 1, Value: unitTotal, Valid: true},
	}
}

func (p *PulseGenericSensor) Name() string { return "PulseGeneric" }
