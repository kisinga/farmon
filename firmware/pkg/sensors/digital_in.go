package sensors

import "machine"

// DigitalInSensor reads a GPIO pin and reports 1.0 (HIGH) or 0.0 (LOW).
// Useful for float switches, door/reed sensors, relay feedback, and any binary input.
// Param1: 0 = pull-up (default), 1 = pull-down, 2 = floating (no pull).

type DigitalInSensor struct {
	pin      machine.Pin
	fieldIdx uint8
	mode     machine.PinMode
}

func NewDigitalInSensor(pin machine.Pin, fieldIdx uint8, param1 uint16) *DigitalInSensor {
	var mode machine.PinMode
	switch param1 {
	case 1:
		mode = machine.PinInputPulldown
	case 2:
		mode = machine.PinInput
	default:
		mode = machine.PinInputPullup
	}
	return &DigitalInSensor{pin: pin, fieldIdx: fieldIdx, mode: mode}
}

func (d *DigitalInSensor) Begin() {
	d.pin.Configure(machine.PinConfig{Mode: d.mode})
}

func (d *DigitalInSensor) Read() []Reading {
	var v float32
	if d.pin.Get() {
		v = 1.0
	}
	return []Reading{{FieldIndex: d.fieldIdx, Value: v, Valid: true}}
}

func (d *DigitalInSensor) Name() string { return "DigitalIn" }
