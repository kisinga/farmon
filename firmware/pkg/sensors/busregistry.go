package sensors

import (
	"machine"

	"github.com/farm/firmware/pkg/settings"
)

// BusRegistry owns initialized shared bus handles.
// Sensors reference buses by index rather than GPIO, so the bus is initialized
// exactly once regardless of how many sensors share it.
type BusRegistry struct {
	// I2C[0] and I2C[1] correspond to the first and second I2C peripheral.
	// nil means no I2C bus was found in the pin map for that index.
	I2C [2]*machine.I2C

	// UART[0] and UART[1] correspond to the first and second UART peripheral.
	// nil means no UART bus was found in the pin map for that index.
	UART [2]*machine.UART

	// RS485DE[i] is the direction-enable pin for UART[i].
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

// BusHardware provides the target-specific peripheral handles to InitBuses.
// Each target's main.go declares the hardware it has (e.g. machine.I2C0,
// machine.UART0) and passes them here. This removes all hard-coded peripheral
// names from the shared package.
type BusHardware struct {
	I2C  [2]*machine.I2C
	UART [2]*machine.UART
}

// InitBuses scans cfg.PinMap for I2C SDA/SCL pairs, UART TX/RX pairs, and
// RS485 DE pins. It initializes each unique bus once and returns the registry.
//
// boardPins maps a PinMap index to the physical machine.Pin for this target.
// hw provides the concrete I2C and UART peripheral handles for this target.
//
// Convention:
//   - First PinI2CSDA + adjacent PinI2CSCL pair → I2C[0]
//   - Second such pair → I2C[1]
//   - First PinUARTTX + adjacent PinUARTRX pair → UART[0]
//   - Second such pair → UART[1]
//   - PinRS485DE adjacent to a UART TX → RS485DE for that UART bus
func InitBuses(cfg settings.CoreSettings, boardPins [settings.MaxPins]machine.Pin, hw BusHardware) *BusRegistry {
	reg := &BusRegistry{}

	i2cIdx := 0
	uartIdx := 0

	for i := 0; i < settings.MaxPins-1; i++ {
		fn := cfg.PinMap[i]
		next := cfg.PinMap[i+1]

		// I2C bus: SDA followed by SCL on adjacent pins
		if fn == settings.PinI2CSDA && next == settings.PinI2CSCL && i2cIdx < 2 {
			if hw.I2C[i2cIdx] != nil {
				hw.I2C[i2cIdx].Configure(machine.I2CConfig{
					SDA:       boardPins[i],
					SCL:       boardPins[i+1],
					Frequency: 400_000,
				})
				reg.I2C[i2cIdx] = hw.I2C[i2cIdx]
			}
			i2cIdx++
			i++ // skip SCL pin
			continue
		}

		// UART bus: TX followed by RX on adjacent pins
		if fn == settings.PinUARTTX && next == settings.PinUARTRX && uartIdx < 2 {
			if hw.UART[uartIdx] != nil {
				hw.UART[uartIdx].Configure(machine.UARTConfig{
					TX:       boardPins[i],
					RX:       boardPins[i+1],
					BaudRate: 9600,
				})
				reg.UART[uartIdx] = hw.UART[uartIdx]
				// Check if the pin after RX is RS485 DE
				if i+2 < settings.MaxPins && cfg.PinMap[i+2] == settings.PinRS485DE {
					reg.RS485DE[uartIdx] = boardPins[i+2]
					reg.hasRS485DE[uartIdx] = true
					dePin := boardPins[i+2]
					dePin.Configure(machine.PinConfig{Mode: machine.PinOutput})
					dePin.Low() // default: receive mode
				}
			}
			uartIdx++
			i++ // skip RX pin
			continue
		}
	}

	return reg
}
