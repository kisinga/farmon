//go:build esp32s3

// Stub bus registry for ESP32-S3 — TinyGo lacks machine.I2C and SPI on this target.
// All bus-dependent sensors are excluded via build tags; this provides the minimal
// types needed by the rest of the sensors package.
package sensors

import (
	"machine"

	"github.com/kisinga/farmon/firmware/pkg/settings"
)

// BusRegistry — esp32s3 stub with no I2C or UART buses.
type BusRegistry struct {
	RS485DE    [2]machine.Pin
	hasRS485DE [2]bool
}

func (b *BusRegistry) RS485DEPin(busIdx int) (machine.Pin, bool) {
	return 0, false
}

// BusHardware — esp32s3 stub (no I2C or UART peripherals available).
type BusHardware struct{}

// InitBuses — no-op on esp32s3 (no bus peripherals to initialize).
func InitBuses(_ *settings.CoreSettings, _ [settings.MaxPins]machine.Pin, _ BusHardware) *BusRegistry {
	return &BusRegistry{}
}
