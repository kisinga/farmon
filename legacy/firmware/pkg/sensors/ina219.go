//go:build farmon_ina219 || farmon_all

package sensors

import "machine"

// INA219Sensor reads bus voltage, shunt current, and power via I2C.
// PinIndex = I2C bus index; Param1 lo byte = I2C device address (default 0x40).
// Assumes a 0.1 Ω shunt resistor.
// Outputs 3 readings at fieldIdx, fieldIdx+1, fieldIdx+2: voltage(V), current(A), power(W).

type INA219Sensor struct {
	bus      *machine.I2C
	addr     uint8
	fieldIdx uint8
}

func NewINA219Sensor(bus *machine.I2C, addr uint8, fieldIdx uint8) *INA219Sensor {
	return &INA219Sensor{bus: bus, addr: addr, fieldIdx: fieldIdx}
}

func (s *INA219Sensor) Begin() {
	if s.bus == nil {
		return
	}
	// Config: 32 V range, ±320 mV shunt, 12-bit ADC, continuous shunt+bus
	s.bus.WriteRegister(s.addr, 0x00, []byte{0x39, 0x9F})
}

func (s *INA219Sensor) Read() []Reading {
	invalid := []Reading{
		{FieldIndex: s.fieldIdx, Valid: false},
		{FieldIndex: s.fieldIdx + 1, Valid: false},
		{FieldIndex: s.fieldIdx + 2, Valid: false},
	}
	if s.bus == nil {
		return invalid
	}

	buf := make([]byte, 2)

	// Bus voltage (reg 0x02): bits 15:3, LSB = 4 mV
	s.bus.ReadRegister(s.addr, 0x02, buf)
	busVoltage := float32(int16(uint16(buf[0])<<8|uint16(buf[1]))>>3) * 0.004

	// Shunt voltage (reg 0x01): LSB = 10 µV; I = Vshunt / 0.1 Ω
	s.bus.ReadRegister(s.addr, 0x01, buf)
	shuntUV := float32(int16(uint16(buf[0])<<8 | uint16(buf[1])))
	currentA := (shuntUV * 0.00001) / 0.1

	return []Reading{
		{FieldIndex: s.fieldIdx, Value: busVoltage, Valid: true},
		{FieldIndex: s.fieldIdx + 1, Value: currentA, Valid: true},
		{FieldIndex: s.fieldIdx + 2, Value: busVoltage * currentA, Valid: true},
	}
}

func (s *INA219Sensor) Name() string { return "INA219" }
