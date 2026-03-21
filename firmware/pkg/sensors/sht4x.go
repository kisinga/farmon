//go:build farmon_sht4x || farmon_all

package sensors

import (
	"machine"

	"tinygo.org/x/drivers/sht4x"
)

type SHT4xSensor struct {
	dev      *sht4x.Device
	fieldIdx uint8
}

func NewSHT4xSensor(bus *machine.I2C, addr uint8, fieldIdx uint8) *SHT4xSensor {
	dev := sht4x.New(bus)
	dev.Address = addr
	return &SHT4xSensor{dev: &dev, fieldIdx: fieldIdx}
}

func (s *SHT4xSensor) Begin() {}

func (s *SHT4xSensor) Read() []Reading {
	temp, hum, err := s.dev.ReadTemperatureHumidity()
	if err != nil {
		return []Reading{
			{FieldIndex: s.fieldIdx, Valid: false},
			{FieldIndex: s.fieldIdx + 1, Valid: false},
		}
	}
	return []Reading{
		{FieldIndex: s.fieldIdx, Value: float32(temp) / 1000, Valid: true},
		{FieldIndex: s.fieldIdx + 1, Value: float32(hum) / 1000, Valid: true},
	}
}

func (s *SHT4xSensor) Name() string { return "SHT4x" }
