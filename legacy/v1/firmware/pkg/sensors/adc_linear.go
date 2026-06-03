//go:build rp2040

package sensors

import "machine"

// ADCLinearSensor reads any sensor with a linear 0–VREF voltage output.
// Param1 = CalibOffset (int16 × 10 stored as uint16 bits).
// Param2 = CalibSpan  (uint16 × 10).
// output = offset + (raw_adc / 65535) × span

type ADCLinearSensor struct {
	adc      machine.ADC
	fieldIdx uint8
	param1   uint16
	param2   uint16
}

func NewADCLinearSensor(pin machine.Pin, fieldIdx uint8, param1, param2 uint16) *ADCLinearSensor {
	return &ADCLinearSensor{adc: machine.ADC{Pin: pin}, fieldIdx: fieldIdx, param1: param1, param2: param2}
}

func (s *ADCLinearSensor) Begin() {
	s.adc.Configure(machine.ADCConfig{})
}

func (s *ADCLinearSensor) Read() []Reading {
	offset, span := decodeCalibParams(s.param1, s.param2)
	normalized := float32(s.adc.Get()) / 65535.0
	return []Reading{{FieldIndex: s.fieldIdx, Value: offset + normalized*span, Valid: true}}
}

func (s *ADCLinearSensor) Name() string { return "ADCLinear" }
