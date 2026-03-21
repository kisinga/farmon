//go:build farmon_ds18b20 || farmon_all

package sensors

import (
	"machine"
	"time"

	"tinygo.org/x/drivers/ds18b20"
	"tinygo.org/x/drivers/onewire"
)

// DS18B20Sensor reads temperature from a Dallas 1-Wire DS18B20 sensor
// using the TinyGo ds18b20 + onewire drivers.
// PinIndex = GPIO pin.
type DS18B20Sensor struct {
	ow       *onewire.Device
	dev      ds18b20.Device
	fieldIdx uint8
}

func NewDS18B20Sensor(pin machine.Pin, fieldIdx uint8) *DS18B20Sensor {
	ow := onewire.New(pin)
	dev := ds18b20.New(&ow)
	return &DS18B20Sensor{ow: &ow, dev: dev, fieldIdx: fieldIdx}
}

func (s *DS18B20Sensor) Begin() {
	s.ow.Configure(onewire.Config{})
	s.dev.Configure()
}

func (s *DS18B20Sensor) Read() []Reading {
	// Use SKIP ROM (nil romid) for single-device bus
	s.dev.RequestTemperature(nil)
	time.Sleep(750 * time.Millisecond)

	tempMilliC, err := s.dev.ReadTemperature(nil)
	if err != nil {
		return []Reading{{FieldIndex: s.fieldIdx, Valid: false}}
	}
	return []Reading{{FieldIndex: s.fieldIdx, Value: float32(tempMilliC) / 1000, Valid: true}}
}

func (s *DS18B20Sensor) Name() string { return "DS18B20" }
