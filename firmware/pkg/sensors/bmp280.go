//go:build farmon_bmp280 || farmon_all

package sensors

import (
	"machine"

	"tinygo.org/x/drivers/bmp280"
)

type BMP280Sensor struct {
	dev      *bmp280.Device
	fieldIdx uint8
}

func NewBMP280Sensor(bus *machine.I2C, addr uint8, fieldIdx uint8) *BMP280Sensor {
	dev := bmp280.New(bus)
	dev.Address = uint16(addr)
	return &BMP280Sensor{dev: &dev, fieldIdx: fieldIdx}
}

func (s *BMP280Sensor) Begin() {
	s.dev.Configure(bmp280.STANDBY_63MS, bmp280.FILTER_4X, bmp280.SAMPLING_2X, bmp280.SAMPLING_16X, bmp280.MODE_NORMAL)
}

func (s *BMP280Sensor) Read() []Reading {
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

func (s *BMP280Sensor) Name() string { return "BMP280" }
