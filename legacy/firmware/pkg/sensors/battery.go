//go:build rp2040

package sensors

import "machine"

// BatteryADC reads a LiPo battery voltage via ADC (3.0–4.2V curve)
// and reports a 0–100% charge percentage.
// Assumes a 2:1 voltage divider on the ADC pin at 3.3V reference.

type BatteryADC struct {
	adc      machine.ADC
	fieldIdx uint8
}

func NewBatteryADC(pin machine.Pin, fieldIdx uint8) *BatteryADC {
	return &BatteryADC{adc: machine.ADC{Pin: pin}, fieldIdx: fieldIdx}
}

func (b *BatteryADC) Begin() {
	b.adc.Configure(machine.ADCConfig{})
}

func (b *BatteryADC) Read() []Reading {
	raw := b.adc.Get()
	voltage := float32(raw) / 65535.0 * 3.3 * 2.0
	pct := (voltage - 3.0) / (4.2 - 3.0) * 100.0
	if pct < 0 {
		pct = 0
	}
	if pct > 100 {
		pct = 100
	}
	return []Reading{{FieldIndex: b.fieldIdx, Value: pct, Valid: true}}
}

func (b *BatteryADC) Name() string { return "BatteryADC" }
