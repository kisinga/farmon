//go:build rp2040

package sensors

import "machine"

// SoilADCSensor reads a capacitive soil moisture sensor via ADC.
// Param1 = dryRaw (ADC count at bone-dry, typically ~55000 on 16-bit).
// Param2 = wetRaw (ADC count at fully saturated, typically ~18000).
// Output: 0–100% moisture (higher ADC = drier on capacitive sensors).

type SoilADCSensor struct {
	adc      machine.ADC
	fieldIdx uint8
	dryRaw   uint16
	wetRaw   uint16
}

func NewSoilADCSensor(pin machine.Pin, fieldIdx uint8, dryRaw, wetRaw uint16) *SoilADCSensor {
	return &SoilADCSensor{
		adc:      machine.ADC{Pin: pin},
		fieldIdx: fieldIdx,
		dryRaw:   dryRaw,
		wetRaw:   wetRaw,
	}
}

func (s *SoilADCSensor) Begin() {
	s.adc.Configure(machine.ADCConfig{})
}

func (s *SoilADCSensor) Read() []Reading {
	raw := s.adc.Get()
	dry := float32(s.dryRaw)
	wet := float32(s.wetRaw)
	if dry <= wet {
		// Invalid calibration — fall back to raw normalised percentage
		return []Reading{{FieldIndex: s.fieldIdx, Value: float32(raw) / 65535.0 * 100.0, Valid: true}}
	}
	pct := (dry - float32(raw)) / (dry - wet) * 100.0
	if pct < 0 {
		pct = 0
	}
	if pct > 100 {
		pct = 100
	}
	return []Reading{{FieldIndex: s.fieldIdx, Value: pct, Valid: true}}
}

func (s *SoilADCSensor) Name() string { return "SoilADC" }
