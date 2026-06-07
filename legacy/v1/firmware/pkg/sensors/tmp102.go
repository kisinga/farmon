//go:build farmon_tmp102 || farmon_all

package sensors

import (
	"machine"

	"tinygo.org/x/drivers/tmp102"
)

type TMP102Sensor struct {
	dev      *tmp102.Device
	fieldIdx uint8
}

func NewTMP102Sensor(bus *machine.I2C, addr uint8, fieldIdx uint8) *TMP102Sensor {
	dev := tmp102.New(bus)
	dev.Configure(tmp102.Config{Address: addr})
	return &TMP102Sensor{dev: &dev, fieldIdx: fieldIdx}
}

func (s *TMP102Sensor) Begin() {}

func (s *TMP102Sensor) Read() []Reading {
	temp, err := s.dev.ReadTemperature()
	if err != nil {
		return []Reading{{FieldIndex: s.fieldIdx, Valid: false}}
	}
	return []Reading{{FieldIndex: s.fieldIdx, Value: float32(temp) / 1000, Valid: true}}
}

func (s *TMP102Sensor) Name() string { return "TMP102" }
