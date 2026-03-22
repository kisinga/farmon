//go:build farmon_mcp9808 || farmon_all

package sensors

import (
	"machine"

	"tinygo.org/x/drivers/mcp9808"
)

type MCP9808Sensor struct {
	dev      *mcp9808.Device
	fieldIdx uint8
}

func NewMCP9808Sensor(bus *machine.I2C, addr uint8, fieldIdx uint8) *MCP9808Sensor {
	dev := mcp9808.New(bus)
	dev.Address = uint16(addr)
	return &MCP9808Sensor{dev: &dev, fieldIdx: fieldIdx}
}

func (s *MCP9808Sensor) Begin() {}

func (s *MCP9808Sensor) Read() []Reading {
	temp, err := s.dev.ReadTemperature()
	if err != nil {
		return []Reading{{FieldIndex: s.fieldIdx, Valid: false}}
	}
	return []Reading{{FieldIndex: s.fieldIdx, Value: float32(temp), Valid: true}}
}

func (s *MCP9808Sensor) Name() string { return "MCP9808" }
