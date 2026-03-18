// Package actuator defines the hardware-agnostic control output interface.
// No machine import — implementations live in each target's hardware.go.
package actuator

// Actuator is a single controllable output.
// stateIdx 0 = off/closed, 1 = on/open (additional states device-specific).
type Actuator interface {
	Set(stateIdx uint8) bool // returns false if stateIdx is out of range
	State() uint8
}
