// Package transfer implements the autonomous 2-tank water transfer FSM.
// No machine import — all hardware access goes through the actuator.Actuator
// interface and a ReadLevel callback.
package transfer

import (
	"github.com/farmon/firmware/pkg/actuator"
	"github.com/farmon/firmware/pkg/settings"
)

// State represents the current FSM phase.
type State uint8

const (
	StateIdle      State = 0 // monitoring, no transfer in progress
	StateMeasuring State = 1 // mid-measurement sequence (blocking)
	StatePumping   State = 2 // actively transferring water
)

// Config holds all FSM parameters and hardware references.
// ReadLevel is called after valve/solenoid settle to get a direct ADC reading;
// this is needed because the normal sensor loop reads before valves open.
type Config struct {
	Pump    actuator.Actuator // pump relay
	ValveT1 actuator.Actuator // motorized valve: Tank1 → shared pipe
	ValveT2 actuator.Actuator // motorized valve: Tank2 → shared pipe
	SV      actuator.Actuator // solenoid valve (momentary, pressure equalization)

	// ReadLevel returns the current pressure-sensor reading as a 0–100 percent level.
	// Called after valve/solenoid pulse has settled.
	ReadLevel func() float32

	StartDelta   float32 // start transfer when T1-T2 exceeds this (e.g. 20.0)
	StopT1Min    float32 // stop when T1 level falls below this (e.g. 15.0)
	MeasureEvery uint32  // ms between mid-pump remeasure cycles (0 = never remeasure)
}

// FSM is the autonomous water transfer state machine.
type FSM struct {
	cfg           Config
	state         State
	levelT1       float32
	levelT2       float32
	lastMeasureMs uint32
}

// New creates a new FSM from the given Config.
func New(cfg Config) *FSM {
	return &FSM{cfg: cfg}
}

// NewFromSettings constructs a Config from CoreSettings and a set of actuator
// slots. Returns nil if transfer is disabled or ReadLevel is nil.
func NewFromSettings(t *settings.TransferConfig, acts [settings.MaxControls]actuator.Actuator, readLevel func() float32) *FSM {
	if t.Enabled == 0 || readLevel == nil {
		return nil
	}
	cfg := Config{
		Pump:         acts[t.PumpCtrlIdx],
		ValveT1:      acts[t.ValveT1CtrlIdx],
		ValveT2:      acts[t.ValveT2CtrlIdx],
		SV:           acts[t.SVCtrlIdx],
		ReadLevel:    readLevel,
		StartDelta:   float32(t.StartDeltaPct),
		StopT1Min:    float32(t.StopT1MinPct),
		MeasureEvery: uint32(t.MeasurePulseSec) * 1000,
	}
	return New(cfg)
}

// CurrentState returns the current FSM phase for diagnostic telemetry.
func (f *FSM) CurrentState() State { return f.state }

// ForceIdle aborts any in-progress transfer and returns all actuators to safe state.
// Called by the downlink handler when the backend sends a manual override.
func (f *FSM) ForceIdle() {
	if f.state != StateIdle {
		f.stopTransfer()
		println("[transfer] forced idle by downlink")
	}
}

// Tick is called every sensor loop iteration with the latest sensor values and
// current time in milliseconds. Blocking calls only happen on state transitions
// (valve open/close, solenoid pulse) — these are infrequent events.
func (f *FSM) Tick(values []float32, nowMs uint32) State {
	switch f.state {
	case StateIdle:
		f.tickIdle(nowMs)
	case StatePumping:
		f.tickPumping(nowMs)
	}
	return f.state
}

func (f *FSM) tickIdle(nowMs uint32) {
	// Periodic measurement: measure T1 then T2 using the shared sensor.
	if f.lastMeasureMs != 0 && nowMs-f.lastMeasureMs < f.cfg.MeasureEvery {
		return
	}
	f.lastMeasureMs = nowMs

	f.levelT1 = f.doMeasure(f.cfg.ValveT1)
	f.levelT2 = f.doMeasure(f.cfg.ValveT2)
	println("[transfer] idle measure T1=", int(f.levelT1), "T2=", int(f.levelT2))

	if f.shouldStartTransfer() {
		f.startTransfer(nowMs)
	}
}

func (f *FSM) tickPumping(nowMs uint32) {
	// Check stop conditions.
	if f.levelT2 >= 100 || f.levelT1 <= f.cfg.StopT1Min {
		println("[transfer] stop condition met T1=", int(f.levelT1), "T2=", int(f.levelT2))
		f.stopTransfer()
		return
	}

	// Periodic remeasure while pumping.
	if f.cfg.MeasureEvery == 0 {
		return
	}
	if nowMs-f.lastMeasureMs < f.cfg.MeasureEvery {
		return
	}
	f.lastMeasureMs = nowMs

	// Pause pump, remeasure, decide.
	f.cfg.Pump.Set(0)
	f.levelT1 = f.doMeasure(f.cfg.ValveT1)
	f.levelT2 = f.doMeasure(f.cfg.ValveT2)
	println("[transfer] pump measure T1=", int(f.levelT1), "T2=", int(f.levelT2))

	if f.levelT2 >= 100 || f.levelT1 <= f.cfg.StopT1Min {
		f.stopTransfer()
	} else {
		// Reopen T1 valve and resume pump.
		f.cfg.ValveT1.Set(1)
		f.cfg.Pump.Set(1)
	}
}

// doMeasure opens valve, pulses solenoid to equalize pressure, reads level, closes valve.
// Blocks while motorized valve transitions and solenoid pulses.
func (f *FSM) doMeasure(valve actuator.Actuator) float32 {
	valve.Set(1) // open — blocks for motorized valve pulse duration
	f.cfg.SV.Set(1) // solenoid pulse — blocks, then auto-off
	level := f.cfg.ReadLevel()
	valve.Set(0) // close — blocks for motorized valve pulse duration
	return level
}

func (f *FSM) shouldStartTransfer() bool {
	delta := f.levelT1 - f.levelT2
	return delta > f.cfg.StartDelta &&
		f.levelT2 < 100 &&
		f.levelT1 > f.cfg.StopT1Min
}

func (f *FSM) startTransfer(nowMs uint32) {
	println("[transfer] starting transfer T1=", int(f.levelT1), "T2=", int(f.levelT2))
	f.cfg.ValveT1.Set(1) // open Tank1 → pipe
	f.cfg.Pump.Set(1)
	f.state = StatePumping
	f.lastMeasureMs = nowMs
}

func (f *FSM) stopTransfer() {
	f.cfg.Pump.Set(0)
	f.cfg.ValveT1.Set(0)
	f.cfg.ValveT2.Set(0)
	f.state = StateIdle
	f.lastMeasureMs = 0
}
