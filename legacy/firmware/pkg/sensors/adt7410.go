//go:build farmon_adt7410 || farmon_all

package sensors

import (
	"machine"

	"tinygo.org/x/drivers/adt7410"
)

type ADT7410Sensor struct {
	dev      *adt7410.Device
	fieldIdx uint8
}

func NewADT7410Sensor(bus *machine.I2C, addr uint8, fieldIdx uint8) *ADT7410Sensor {
	dev := adt7410.New(bus)
	dev.Address = addr
	return &ADT7410Sensor{dev: dev, fieldIdx: fieldIdx}
}

func (s *ADT7410Sensor) Begin() {
	s.dev.Configure()
}

func (s *ADT7410Sensor) Read() []Reading {
	temp, err := s.dev.ReadTemperature()
	if err != nil {
		return []Reading{{FieldIndex: s.fieldIdx, Valid: false}}
	}
	return []Reading{{FieldIndex: s.fieldIdx, Value: float32(temp) / 1000, Valid: true}}
}

func (s *ADT7410Sensor) Name() string { return "ADT7410" }
