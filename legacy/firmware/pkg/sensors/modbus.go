//go:build !esp32s3

package sensors

import (
	"machine"
	"time"
)

// ModbusRTUDriver reads a single Modbus register over RS485/UART.
//
// SensorSlot mapping:
//   PinIndex = UART bus index (0 = first UART, 1 = second UART)
//   Param1 lo byte = Modbus device address (1-247)
//   Param1 hi byte = Modbus function code (0x03 = Read Holding, 0x04 = Read Input)
//   Param2         = Register address (0-based)
//   Flags bit 2    = dataType: 0 = uint16, 1 = int16 (signed)

type ModbusRTUDriver struct {
	uart     *machine.UART
	dePin    machine.Pin
	hasDEPin bool
	devAddr  uint8
	funcCode uint8
	regAddr  uint16
	signed   bool // false = uint16, true = int16
	fieldIdx uint8
}

func NewModbusRTUDriver(uart *machine.UART, dePin machine.Pin, hasDEPin bool,
	devAddr, funcCode uint8, regAddr uint16, signed bool, fieldIdx uint8) *ModbusRTUDriver {
	return &ModbusRTUDriver{
		uart:     uart,
		dePin:    dePin,
		hasDEPin: hasDEPin,
		devAddr:  devAddr,
		funcCode: funcCode,
		regAddr:  regAddr,
		signed:   signed,
		fieldIdx: fieldIdx,
	}
}

func (m *ModbusRTUDriver) Begin() {
	// UART already configured by BusRegistry (9600 baud, 8N1)
	if m.hasDEPin {
		m.dePin.Low() // default: receive mode
	}
}

func (m *ModbusRTUDriver) Read() []Reading {
	if m.uart == nil {
		return []Reading{{FieldIndex: m.fieldIdx, Valid: false}}
	}

	// Build request: [devAddr, funcCode, regHi, regLo, 0x00, 0x01, crcLo, crcHi]
	req := [8]byte{
		m.devAddr,
		m.funcCode,
		byte(m.regAddr >> 8),
		byte(m.regAddr),
		0x00, // quantity hi
		0x01, // quantity lo (read 1 register)
	}
	crc := crc16Modbus(req[:6])
	req[6] = byte(crc)
	req[7] = byte(crc >> 8)

	// TX: enable DE, write, wait for byte-time, disable DE
	if m.hasDEPin {
		m.dePin.High()
	}
	m.uart.Write(req[:])
	// Wait for all bytes to clock out: 8 bytes × 10 bits / 9600 baud ≈ 8.3ms
	time.Sleep(10 * time.Millisecond)
	if m.hasDEPin {
		m.dePin.Low()
	}

	// RX: wait for response (7 bytes: addr, func, byteCount, dataHi, dataLo, crcLo, crcHi)
	var resp [7]byte
	n := modbusRead(m.uart, resp[:], 20*time.Millisecond)
	if n < 7 {
		return []Reading{{FieldIndex: m.fieldIdx, Valid: false}}
	}

	// Validate response CRC
	respCRC := crc16Modbus(resp[:5])
	if resp[5] != byte(respCRC) || resp[6] != byte(respCRC>>8) {
		return []Reading{{FieldIndex: m.fieldIdx, Valid: false}}
	}

	// Validate address and function code echo
	if resp[0] != m.devAddr || resp[1] != m.funcCode {
		return []Reading{{FieldIndex: m.fieldIdx, Valid: false}}
	}

	// Extract 16-bit register value from bytes 3-4
	raw := uint16(resp[3])<<8 | uint16(resp[4])
	var value float32
	if m.signed {
		value = float32(int16(raw))
	} else {
		value = float32(raw)
	}

	return []Reading{{FieldIndex: m.fieldIdx, Value: value, Valid: true}}
}

func (m *ModbusRTUDriver) Name() string { return "ModbusRTU" }

// modbusRead reads up to len(buf) bytes from uart with a per-byte timeout.
func modbusRead(uart *machine.UART, buf []byte, timeout time.Duration) int {
	deadline := time.Now().Add(timeout)
	n := 0
	for n < len(buf) {
		if time.Now().After(deadline) {
			break
		}
		if uart.Buffered() > 0 {
			b, err := uart.ReadByte()
			if err == nil {
				buf[n] = b
				n++
			}
		}
	}
	return n
}

// crc16Modbus computes the Modbus CRC-16 (polynomial 0xA001, init 0xFFFF).
func crc16Modbus(data []byte) uint16 {
	crc := uint16(0xFFFF)
	for _, b := range data {
		crc ^= uint16(b)
		for i := 0; i < 8; i++ {
			if crc&0x0001 != 0 {
				crc = (crc >> 1) ^ 0xA001
			} else {
				crc >>= 1
			}
		}
	}
	return crc
}
