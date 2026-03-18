//go:build stm32wlx

package main

import (
	"machine"
	"time"

	"github.com/farmon/firmware/pkg/actuator"
	"github.com/farmon/firmware/pkg/settings"
)

// --- simpleRelay: single pin, hold high/low ---

type simpleRelay struct {
	pin       machine.Pin
	activeLow bool
	state     uint8
}

func (r *simpleRelay) Set(s uint8) bool {
	r.state = s
	on := s != 0
	if r.activeLow {
		on = !on
	}
	if on {
		r.pin.High()
	} else {
		r.pin.Low()
	}
	return true
}

func (r *simpleRelay) State() uint8 { return r.state }

// --- motorizedValve: dual-pin, timed pulse open/close ---

type motorizedValve struct {
	openPin  machine.Pin
	closePin machine.Pin
	pulseDur time.Duration
	state    uint8
}

func (v *motorizedValve) Set(s uint8) bool {
	var pin machine.Pin
	if s != 0 {
		pin = v.openPin
	} else {
		pin = v.closePin
	}
	pin.High()
	time.Sleep(v.pulseDur)
	pin.Low()
	v.state = s
	return true
}

func (v *motorizedValve) State() uint8 { return v.state }

// --- solenoidMomentary: single pin, pulse then self-off ---

type solenoidMomentary struct {
	pin      machine.Pin
	pulseDur time.Duration
}

func (s *solenoidMomentary) Set(idx uint8) bool {
	if idx != 0 {
		s.pin.High()
		time.Sleep(s.pulseDur)
		s.pin.Low()
	}
	return true
}

func (s *solenoidMomentary) State() uint8 { return 0 } // always off after Set

// --- initActuators: build actuators from ControlSlot config ---

func initActuators() [settings.MaxControls]actuator.Actuator {
	var acts [settings.MaxControls]actuator.Actuator
	for i := uint8(0); i < cfg.Core.ControlCount; i++ {
		ctrl := cfg.Core.Controls[i]
		if !ctrl.Enabled() {
			continue
		}
		pin := boardPins[ctrl.PinIndex]
		pin.Configure(machine.PinConfig{Mode: machine.PinOutput})
		if ctrl.ActiveLow() {
			pin.High() // active-low off state
		} else {
			pin.Low()
		}

		pulseDur := time.Duration(ctrl.PulseDurX100ms) * 100 * time.Millisecond

		switch ctrl.ActuatorType {
		case settings.ActuatorMotorizedValve:
			pin2 := boardPins[ctrl.Pin2Index]
			pin2.Configure(machine.PinConfig{Mode: machine.PinOutput})
			pin2.Low()
			acts[i] = &motorizedValve{
				openPin:  pin,
				closePin: pin2,
				pulseDur: pulseDur,
			}
		case settings.ActuatorSolenoidMomentary:
			acts[i] = &solenoidMomentary{
				pin:      pin,
				pulseDur: pulseDur,
			}
		default: // ActuatorRelay
			acts[i] = &simpleRelay{
				pin:       pin,
				activeLow: ctrl.ActiveLow(),
			}
		}
	}
	return acts
}
