//go:build stm32wlx

// Board-specific radio initialization for STM32WL (internal SX126x).
// The LoRa-E5 has the radio built into the MCU - no external wiring needed.
package main

import (
	"machine"

	"tinygo.org/x/drivers/sx126x"
)

func newRadioControl() sx126x.RadioController {
	return sx126x.NewRadioControl()
}

// The SPI3 peripheral is hardwired to the internal SubGHz radio on STM32WL.
// This is automatically configured by the TinyGo lorae5 target.
var _ = machine.SPI3
