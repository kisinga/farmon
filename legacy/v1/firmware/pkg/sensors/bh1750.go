//go:build farmon_bh1750 || farmon_all

package sensors

import (
	"machine"

	"tinygo.org/x/drivers/bh1750"
)

type BH1750Sensor struct {
	dev      *bh1750.Device
	fieldIdx uint8
}

func NewBH1750Sensor(bus *machine.I2C, addr uint8, fieldIdx uint8) *BH1750Sensor {
	dev := bh1750.New(bus)
	dev.Address = uint16(addr)
	return &BH1750Sensor{dev: &dev, fieldIdx: fieldIdx}
}

func (s *BH1750Sensor) Begin() {
	s.dev.Configure()
}

func (s *BH1750Sensor) Read() []Reading {
	lux := s.dev.Illuminance()
	return []Reading{{FieldIndex: s.fieldIdx, Value: float32(lux), Valid: true}}
}

func (s *BH1750Sensor) Name() string { return "BH1750" }
