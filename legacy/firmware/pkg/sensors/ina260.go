//go:build farmon_ina260 || farmon_all

package sensors

import (
	"machine"

	"tinygo.org/x/drivers/ina260"
)

type INA260Sensor struct {
	dev      *ina260.Device
	fieldIdx uint8
}

func NewINA260Sensor(bus *machine.I2C, addr uint8, fieldIdx uint8) *INA260Sensor {
	dev := ina260.New(bus)
	dev.Address = uint16(addr)
	return &INA260Sensor{dev: &dev, fieldIdx: fieldIdx}
}

func (s *INA260Sensor) Begin() {
	s.dev.Configure(ina260.Config{})
}

func (s *INA260Sensor) Read() []Reading {
	// Voltage in µV, current in µA, power in µW
	voltUV := s.dev.Voltage()
	currUA := s.dev.Current()
	powUW := s.dev.Power()
	return []Reading{
		{FieldIndex: s.fieldIdx, Value: float32(voltUV) / 1_000_000, Valid: true},
		{FieldIndex: s.fieldIdx + 1, Value: float32(currUA) / 1_000_000, Valid: true},
		{FieldIndex: s.fieldIdx + 2, Value: float32(powUW) / 1_000_000, Valid: true},
	}
}

func (s *INA260Sensor) Name() string { return "INA260" }
