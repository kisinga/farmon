//go:build farmon_aht20 || farmon_all

package sensors

import (
	"machine"

	"tinygo.org/x/drivers/aht20"
)

type AHT20Sensor struct {
	dev      *aht20.Device
	fieldIdx uint8
}

func NewAHT20Sensor(bus *machine.I2C, addr uint8, fieldIdx uint8) *AHT20Sensor {
	dev := aht20.New(bus)
	dev.Address = uint16(addr)
	return &AHT20Sensor{dev: &dev, fieldIdx: fieldIdx}
}

func (s *AHT20Sensor) Begin() {
	s.dev.Configure()
}

func (s *AHT20Sensor) Read() []Reading {
	err := s.dev.Read()
	if err != nil {
		return []Reading{
			{FieldIndex: s.fieldIdx, Valid: false},
			{FieldIndex: s.fieldIdx + 1, Valid: false},
		}
	}
	return []Reading{
		{FieldIndex: s.fieldIdx, Value: s.dev.Celsius(), Valid: true},
		{FieldIndex: s.fieldIdx + 1, Value: s.dev.RelHumidity(), Valid: true},
	}
}

func (s *AHT20Sensor) Name() string { return "AHT20" }
