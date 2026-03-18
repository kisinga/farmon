package sensors

import "machine"

// ADC4_20mASensor reads a 4–20 mA current loop sensor via a 250 Ω burden resistor.
// At 3.3 V reference: 4 mA ≈ ADC 19859, 20 mA ≈ ADC 99295.
// Param1 = CalibOffset (int16 × 10 stored as uint16 bits).
// Param2 = CalibSpan  (uint16 × 10).
// output = offset + normalized × span

const (
	adc4mA  float32 = 19859 // ADC counts at 4 mA (1.0 V on 250 Ω at 3.3 V ref)
	adc20mA float32 = 99295 // ADC counts at 20 mA
)

type ADC4_20mASensor struct {
	adc      machine.ADC
	fieldIdx uint8
	param1   uint16
	param2   uint16
}

func NewADC4_20mASensor(pin machine.Pin, fieldIdx uint8, param1, param2 uint16) *ADC4_20mASensor {
	return &ADC4_20mASensor{adc: machine.ADC{Pin: pin}, fieldIdx: fieldIdx, param1: param1, param2: param2}
}

func (s *ADC4_20mASensor) Begin() {
	s.adc.Configure(machine.ADCConfig{})
}

func (s *ADC4_20mASensor) Read() []Reading {
	normalized := (float32(s.adc.Get()) - adc4mA) / (adc20mA - adc4mA)
	if normalized < 0 {
		normalized = 0
	}
	if normalized > 1 {
		normalized = 1
	}
	offset, span := decodeCalibParams(s.param1, s.param2)
	return []Reading{{FieldIndex: s.fieldIdx, Value: offset + normalized*span, Valid: true}}
}

func (s *ADC4_20mASensor) Name() string { return "ADC4_20mA" }
