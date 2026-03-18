package sensors

import (
	"machine"
	"time"
)

// DS18B20Sensor reads temperature from a Dallas 1-Wire DS18B20 sensor.
// PinIndex = GPIO pin. Param1 lo byte = sensor index on bus (0 = first/only device).

type DS18B20Sensor struct {
	pin      machine.Pin
	fieldIdx uint8
}

func NewDS18B20Sensor(pin machine.Pin, fieldIdx uint8) *DS18B20Sensor {
	return &DS18B20Sensor{pin: pin, fieldIdx: fieldIdx}
}

func (d *DS18B20Sensor) Begin() {
	d.pin.Configure(machine.PinConfig{Mode: machine.PinInputPullup})
}

func (d *DS18B20Sensor) Read() []Reading {
	tempC, ok := ds18b20Read(d.pin)
	return []Reading{{FieldIndex: d.fieldIdx, Value: tempC, Valid: ok}}
}

func (d *DS18B20Sensor) Name() string { return "DS18B20" }

// ds18b20Read performs a single 1-Wire temperature conversion and scratchpad read.
func ds18b20Read(pin machine.Pin) (float32, bool) {
	if !owReset(pin) {
		return 0, false
	}
	owWriteByte(pin, 0xCC) // SKIP ROM (single device)
	owWriteByte(pin, 0x44) // CONVERT T
	time.Sleep(750 * time.Millisecond)

	if !owReset(pin) {
		return 0, false
	}
	owWriteByte(pin, 0xCC) // SKIP ROM
	owWriteByte(pin, 0xBE) // READ SCRATCHPAD

	lo := owReadByte(pin)
	hi := owReadByte(pin)
	raw := int16(uint16(hi)<<8 | uint16(lo))
	return float32(raw) / 16.0, true
}
