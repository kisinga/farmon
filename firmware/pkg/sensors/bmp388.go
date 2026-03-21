//go:build farmon_bmp388 || farmon_all

package sensors

import (
	"machine"

	"tinygo.org/x/drivers/bmp388"
)

type BMP388Sensor struct {
	dev      *bmp388.Device
	fieldIdx uint8
}

func NewBMP388Sensor(bus *machine.I2C, addr uint8, fieldIdx uint8) *BMP388Sensor {
	dev := bmp388.New(bus)
	dev.Address = addr
	return &BMP388Sensor{dev: &dev, fieldIdx: fieldIdx}
}

func (s *BMP388Sensor) Begin() {
	s.dev.Configure(bmp388.Config{
		Pressure:    bmp388.Sampling16X,
		Temperature: bmp388.Sampling2X,
		Mode:        bmp388.Normal,
		ODR:         bmp388.Odr25,
		IIR:         bmp388.Coeff3,
	})
}

func (s *BMP388Sensor) Read() []Reading {
	temp, errT := s.dev.ReadTemperature()
	press, errP := s.dev.ReadPressure()
	if errT != nil || errP != nil {
		return []Reading{
			{FieldIndex: s.fieldIdx, Valid: false},
			{FieldIndex: s.fieldIdx + 1, Valid: false},
		}
	}
	return []Reading{
		{FieldIndex: s.fieldIdx, Value: float32(temp) / 1000, Valid: true},
		{FieldIndex: s.fieldIdx + 1, Value: float32(press) / 100000, Valid: true},
	}
}

func (s *BMP388Sensor) Name() string { return "BMP388" }
