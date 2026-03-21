//go:build farmon_bme280 || farmon_all

package sensors

import (
	"machine"

	"tinygo.org/x/drivers/bme280"
)

// BME280Sensor reads temperature, humidity, and pressure via I2C using the TinyGo BME280 driver.
// PinIndex = I2C bus index; Param1 lo byte = I2C device address (default 0x76).
// Outputs 3 readings at fieldIdx, fieldIdx+1, fieldIdx+2: temp(°C), humidity(%RH), pressure(hPa).
type BME280Sensor struct {
	dev      *bme280.Device
	fieldIdx uint8
}

func NewBME280Sensor(bus *machine.I2C, addr uint8, fieldIdx uint8) *BME280Sensor {
	dev := bme280.New(bus)
	dev.Address = uint16(addr)
	return &BME280Sensor{dev: &dev, fieldIdx: fieldIdx}
}

func (s *BME280Sensor) Begin() {
	s.dev.Configure()
}

func (s *BME280Sensor) Read() []Reading {
	temp, errT := s.dev.ReadTemperature()
	hum, errH := s.dev.ReadHumidity()
	press, errP := s.dev.ReadPressure()
	if errT != nil || errH != nil || errP != nil {
		return []Reading{
			{FieldIndex: s.fieldIdx, Valid: false},
			{FieldIndex: s.fieldIdx + 1, Valid: false},
			{FieldIndex: s.fieldIdx + 2, Valid: false},
		}
	}
	return []Reading{
		{FieldIndex: s.fieldIdx, Value: float32(temp) / 1000, Valid: true},         // milli°C → °C
		{FieldIndex: s.fieldIdx + 1, Value: float32(hum) / 100, Valid: true},       // centi% → %RH
		{FieldIndex: s.fieldIdx + 2, Value: float32(press) / 100000, Valid: true},  // millipascal → hPa
	}
}

func (s *BME280Sensor) Name() string { return "BME280" }
