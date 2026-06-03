//go:build farmon_sht3x || farmon_all

package sensors

import (
	"machine"

	"tinygo.org/x/drivers/sht3x"
)

type SHT3xSensor struct {
	dev      *sht3x.Device
	fieldIdx uint8
}

func NewSHT3xSensor(bus *machine.I2C, addr uint8, fieldIdx uint8) *SHT3xSensor {
	dev := sht3x.New(bus)
	dev.Address = uint16(addr)
	return &SHT3xSensor{dev: &dev, fieldIdx: fieldIdx}
}

func (s *SHT3xSensor) Begin() {}

func (s *SHT3xSensor) Read() []Reading {
	temp, hum, err := s.dev.ReadTemperatureHumidity()
	if err != nil {
		return []Reading{
			{FieldIndex: s.fieldIdx, Valid: false},
			{FieldIndex: s.fieldIdx + 1, Valid: false},
		}
	}
	return []Reading{
		{FieldIndex: s.fieldIdx, Value: float32(temp) / 1000, Valid: true},
		{FieldIndex: s.fieldIdx + 1, Value: float32(hum) / 100, Valid: true},
	}
}

func (s *SHT3xSensor) Name() string { return "SHT3x" }
