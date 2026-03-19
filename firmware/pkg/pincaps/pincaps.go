// Package pincaps defines per-pin hardware capabilities for each MCU target.
// The backend imports this package to serve pin capability tables to the frontend.
package pincaps

import "github.com/farmon/firmware/pkg/settings"

// PinCapability is a bitmask of hardware capabilities for a single GPIO pin.
type PinCapability uint16

const (
	CapDigitalIn  PinCapability = 1 << 0
	CapDigitalOut PinCapability = 1 << 1
	CapADC        PinCapability = 1 << 2
	CapDAC        PinCapability = 1 << 3
	CapPWM        PinCapability = 1 << 4
	CapI2C        PinCapability = 1 << 5
	CapUART       PinCapability = 1 << 6
	CapOneWire    PinCapability = 1 << 7
	CapInterrupt  PinCapability = 1 << 8
)

// PinCapsTable is a per-pin capability array for a specific MCU target.
type PinCapsTable [settings.MaxPins]PinCapability

// PinFunctionRequires maps each PinFunction to the capability it requires.
var PinFunctionRequires = map[settings.PinFunction]PinCapability{
	settings.PinFlowSensor: CapInterrupt,
	settings.PinRelay:      CapDigitalOut,
	settings.PinButton:     CapDigitalIn,
	settings.PinADC:        CapADC,
	settings.PinI2CSDA:     CapI2C,
	settings.PinI2CSCL:     CapI2C,
	settings.PinOneWire:    CapOneWire | CapDigitalOut,
	settings.PinUARTTX:     CapUART,
	settings.PinUARTRX:     CapUART,
	settings.PinLED:        CapDigitalOut,
	settings.PinCounter:    CapInterrupt,
	settings.PinRS485DE:    CapDigitalOut,
	settings.PinPWM:        CapPWM,
	settings.PinDAC:        CapDAC,
}

// Supports returns true if the pin at idx supports the given capability.
func (t *PinCapsTable) Supports(idx uint8, cap PinCapability) bool {
	if int(idx) >= len(t) {
		return false
	}
	return t[idx]&cap != 0
}

// ValidateFunction checks if pin idx can be assigned the given PinFunction.
func (t *PinCapsTable) ValidateFunction(idx uint8, fn settings.PinFunction) bool {
	if fn == settings.PinNone {
		return true
	}
	req, ok := PinFunctionRequires[fn]
	if !ok {
		return false
	}
	return t.Supports(idx, req)
}

// --- Per-target capability tables ---

// RP2040Caps defines pin capabilities for the Raspberry Pi RP2040 (Pico W).
// All GP0-GP19 mapped pins support digital I/O, PWM, and interrupts.
// GP26-GP28 (mapped to indices if used) additionally support ADC.
// RP2040 has NO DAC hardware.
var RP2040Caps = func() PinCapsTable {
	var t PinCapsTable
	base := CapDigitalIn | CapDigitalOut | CapPWM | CapInterrupt | CapI2C | CapUART | CapOneWire
	for i := range t {
		t[i] = base
	}
	return t
}()

// STM32WLCaps defines pin capabilities for the STM32WL (LoRa-E5 module).
// More restricted than RP2040: PWM only on timer-capable pins, DAC on PA10.
var STM32WLCaps = func() PinCapsTable {
	var t PinCapsTable
	base := CapDigitalIn | CapDigitalOut | CapInterrupt
	for i := range t {
		t[i] = base
	}
	// ADC-capable pins (common STM32WL ADC channels)
	for _, i := range []int{3, 8, 14} {
		t[i] |= CapADC
	}
	// I2C-capable pins
	for _, i := range []int{14, 15} {
		t[i] |= CapI2C
	}
	// UART-capable pins
	for _, i := range []int{8, 9, 16, 17} {
		t[i] |= CapUART
	}
	// PWM-capable pins (timer outputs)
	for _, i := range []int{3, 4, 5, 6, 7, 11, 12, 13} {
		t[i] |= CapPWM
	}
	// DAC (PA10 equivalent)
	t[10] |= CapDAC
	// OneWire (any digital pin can bit-bang)
	for i := range t {
		t[i] |= CapOneWire
	}
	return t
}()

// ForMCU returns the pin capability table for the given MCU identifier.
func ForMCU(mcu string) *PinCapsTable {
	switch mcu {
	case "rp2040":
		return &RP2040Caps
	case "stm32wl", "lorae5":
		return &STM32WLCaps
	default:
		return &RP2040Caps
	}
}
