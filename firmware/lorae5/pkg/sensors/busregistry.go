package sensors

import (
	"machine"

	"github.com/farm/lorae5/pkg/settings"
)

// BusRegistry owns initialized shared bus handles.
// Sensors reference buses by index rather than GPIO, so the bus is initialized
// exactly once regardless of how many sensors share it.
type BusRegistry struct {
	// I2C[0] and I2C[1] correspond to the first and second I2C peripheral.
	// nil means no I2C bus was found in the pin map for that index.
	I2C [2]*machine.I2C

	// UART[0] and UART[1] correspond to UART1 and UART2.
	// nil means no UART bus was found in the pin map for that index.
	UART [2]*machine.UART

	// RS485DE[i] is the direction-enable pin for UART[i].
	// Zero value (machine.Pin(0)) means no DE pin configured.
	RS485DE [2]machine.Pin

	// hasRS485DE[i] is true if RS485DE[i] was explicitly configured.
	hasRS485DE [2]bool
}

// RS485DEPin returns the RS485 DE pin for the given UART bus index, and
// whether one was configured.
func (b *BusRegistry) RS485DEPin(busIdx int) (machine.Pin, bool) {
	if busIdx < 0 || busIdx >= len(b.hasRS485DE) {
		return 0, false
	}
	return b.RS485DE[busIdx], b.hasRS485DE[busIdx]
}

// InitBuses scans cfg.PinMap for I2C SDA/SCL pairs, UART TX/RX pairs, and
// RS485 DE pins. It initializes each unique bus once and returns the registry.
//
// Convention (matches boardPins in main.go):
//   - First PinI2CSDA + adjacent PinI2CSCL pair → I2C[0]
//   - Second such pair → I2C[1]
//   - First PinUARTTX + adjacent PinUARTRX pair → UART[0]
//   - Second such pair → UART[1]
//   - PinRS485DE adjacent to a UART TX → RS485DE for that UART bus
func InitBuses(cfg settings.DeviceSettings) *BusRegistry {
	reg := &BusRegistry{}

	i2cIdx := 0
	uartIdx := 0

	for i := 0; i < settings.MaxPins-1; i++ {
		fn := cfg.PinMap[i]
		next := cfg.PinMap[i+1]

		// I2C bus: SDA followed by SCL on adjacent pins
		if fn == settings.PinI2CSDA && next == settings.PinI2CSCL && i2cIdx < 2 {
			switch i2cIdx {
			case 0:
				machine.I2C0.Configure(machine.I2CConfig{
					SDA:       boardPin(i),
					SCL:       boardPin(i + 1),
					Frequency: 400_000,
				})
				reg.I2C[0] = machine.I2C0
			case 1:
				machine.I2C1.Configure(machine.I2CConfig{
					SDA:       boardPin(i),
					SCL:       boardPin(i + 1),
					Frequency: 400_000,
				})
				reg.I2C[1] = machine.I2C1
			}
			i2cIdx++
			i++ // skip SCL pin
			continue
		}

		// UART bus: TX followed by RX on adjacent pins
		if fn == settings.PinUARTTX && next == settings.PinUARTRX && uartIdx < 2 {
			switch uartIdx {
			case 0:
				machine.UART1.Configure(machine.UARTConfig{
					TX:       boardPin(i),
					RX:       boardPin(i + 1),
					BaudRate: 9600,
				})
				reg.UART[0] = machine.UART1
				// Check if the pin after RX is RS485 DE
				if i+2 < settings.MaxPins && cfg.PinMap[i+2] == settings.PinRS485DE {
					reg.RS485DE[0] = boardPin(i + 2)
					reg.hasRS485DE[0] = true
					dePin := boardPin(i + 2)
					dePin.Configure(machine.PinConfig{Mode: machine.PinOutput})
					dePin.Low() // default: receive mode
				}
			case 1:
				machine.UART2.Configure(machine.UARTConfig{
					TX:       boardPin(i),
					RX:       boardPin(i + 1),
					BaudRate: 9600,
				})
				reg.UART[1] = machine.UART2
				if i+2 < settings.MaxPins && cfg.PinMap[i+2] == settings.PinRS485DE {
					reg.RS485DE[1] = boardPin(i + 2)
					reg.hasRS485DE[1] = true
					dePin := boardPin(i + 2)
					dePin.Configure(machine.PinConfig{Mode: machine.PinOutput})
					dePin.Low()
				}
			}
			uartIdx++
			i++ // skip RX pin
			continue
		}
	}

	return reg
}

// boardPin maps a pin map index to the physical machine.Pin.
// This must match the boardPins table in main.go.
var boardPinTable = [settings.MaxPins]machine.Pin{
	machine.PA0, machine.PA1, machine.PA2, machine.PA3,
	machine.PA4, machine.PA5, machine.PA6, machine.PA7,
	machine.PB0, machine.PB1, machine.PB2, machine.PB3,
	machine.PB4, machine.PB5, machine.PB6, machine.PB7,
	machine.PB8, machine.PB9, machine.PB10, machine.PB15,
}

func boardPin(i int) machine.Pin {
	if i < 0 || i >= settings.MaxPins {
		return machine.NoPin
	}
	return boardPinTable[i]
}
