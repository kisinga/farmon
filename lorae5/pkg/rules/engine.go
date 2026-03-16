// Package rules implements the edge rules engine.
// Direct port of C++ EdgeRulesEngine with identical binary wire format.
package rules

import (
	"github.com/farm/lorae5/pkg/settings"
)

const StateChangeSize = 11 // bytes per state change event

type TriggerSource uint8

const (
	TriggerBoot     TriggerSource = 0
	TriggerRule     TriggerSource = 1
	TriggerManual   TriggerSource = 2
	TriggerDownlink TriggerSource = 3
)

// ControlState tracks the current state of a control output.
type ControlState struct {
	CurrentState  uint8
	IsManual      bool
	ManualUntilMs uint32
}

// StateChange is queued for uplink when a control changes state.
type StateChange struct {
	ControlIdx uint8
	NewState   uint8
	OldState   uint8
	Source     TriggerSource
	RuleID     uint8
	DeviceMs   uint32
	SequenceID uint16
}

// ToBinary serializes to the 11-byte uplink format (fPort 3).
func (sc *StateChange) ToBinary(buf []byte) int {
	if len(buf) < StateChangeSize {
		return 0
	}
	buf[0] = sc.ControlIdx
	buf[1] = sc.NewState
	buf[2] = sc.OldState
	buf[3] = uint8(sc.Source)
	buf[4] = sc.RuleID
	buf[5] = uint8(sc.DeviceMs)
	buf[6] = uint8(sc.DeviceMs >> 8)
	buf[7] = uint8(sc.DeviceMs >> 16)
	buf[8] = uint8(sc.DeviceMs >> 24)
	buf[9] = uint8(sc.SequenceID)
	buf[10] = uint8(sc.SequenceID >> 8)
	return StateChangeSize
}

// SetControlFn is called when a rule fires and a control needs to change.
type SetControlFn func(controlIdx, stateIdx uint8) bool

// Engine evaluates rules against sensor readings and triggers control actions.
type Engine struct {
	rules      []settings.Rule
	controls   [settings.MaxControls]ControlState
	changes    [20]StateChange // ring buffer
	head       int
	count      int
	sequenceID uint16
	setControl SetControlFn
}

func New(setControl SetControlFn) *Engine {
	return &Engine{setControl: setControl}
}

// LoadRules replaces the current rule set.
func (e *Engine) LoadRules(rules []settings.Rule) {
	e.rules = rules
}

// Evaluate checks all rules against current sensor values.
func (e *Engine) Evaluate(values []float32, nowMs uint32) {
	if len(e.rules) == 0 {
		return
	}

	// Find the highest-priority triggered rule per control
	type winner struct {
		ruleIdx  int
		priority uint8
		valid    bool
	}
	best := [settings.MaxControls]winner{}

	for i := range e.rules {
		r := &e.rules[i]
		if !r.Enabled {
			continue
		}
		if int(r.FieldIdx) >= len(values) {
			continue
		}
		// Skip manual override
		cs := &e.controls[r.ControlIdx]
		if cs.IsManual {
			if cs.ManualUntilMs == 0 || nowMs < cs.ManualUntilMs {
				continue
			}
			cs.IsManual = false
		}

		if evaluateCondition(r.Op, values[r.FieldIdx], r.Threshold) {
			b := &best[r.ControlIdx]
			if !b.valid || r.Priority < b.priority {
				b.ruleIdx = i
				b.priority = r.Priority
				b.valid = true
			}
		}
	}

	// Execute winning rules where state actually changes
	for ctrlIdx := uint8(0); ctrlIdx < settings.MaxControls; ctrlIdx++ {
		b := &best[ctrlIdx]
		if !b.valid {
			continue
		}
		r := &e.rules[b.ruleIdx]
		if e.controls[ctrlIdx].CurrentState == r.ActionState {
			continue
		}

		if e.setControl != nil {
			if !e.setControl(ctrlIdx, r.ActionState) {
				continue
			}
		}

		e.recordChange(ctrlIdx, r.ActionState, TriggerRule, r.ID, nowMs)
	}
}

// SetState allows external state changes (downlinks, manual).
func (e *Engine) SetState(ctrlIdx, stateIdx uint8, source TriggerSource, ruleID uint8, nowMs uint32) {
	if e.setControl != nil {
		e.setControl(ctrlIdx, stateIdx)
	}
	e.recordChange(ctrlIdx, stateIdx, source, ruleID, nowMs)
}

// SetManualOverride locks a control in manual mode.
func (e *Engine) SetManualOverride(ctrlIdx uint8, durationMs, nowMs uint32) {
	cs := &e.controls[ctrlIdx]
	cs.IsManual = true
	if durationMs > 0 {
		cs.ManualUntilMs = nowMs + durationMs
	} else {
		cs.ManualUntilMs = 0
	}
}

func (e *Engine) ClearManualOverride(ctrlIdx uint8) {
	e.controls[ctrlIdx].IsManual = false
	e.controls[ctrlIdx].ManualUntilMs = 0
}

// HasPending returns true if there are state changes to transmit.
func (e *Engine) HasPending() bool { return e.count > 0 }

// FormatBatch writes pending state changes into buf. Returns bytes written and event count.
func (e *Engine) FormatBatch(buf []byte) (int, int) {
	maxEvents := len(buf) / StateChangeSize
	if maxEvents > e.count {
		maxEvents = e.count
	}
	offset := 0
	for i := 0; i < maxEvents; i++ {
		idx := (e.head + i) % len(e.changes)
		offset += e.changes[idx].ToBinary(buf[offset:])
	}
	return offset, maxEvents
}

// ClearBatch removes n events from the front of the queue.
func (e *Engine) ClearBatch(n int) {
	if n >= e.count {
		e.count = 0
		e.head = 0
	} else {
		e.head = (e.head + n) % len(e.changes)
		e.count -= n
	}
}

func (e *Engine) recordChange(ctrlIdx, newState uint8, source TriggerSource, ruleID uint8, nowMs uint32) {
	old := e.controls[ctrlIdx].CurrentState
	e.controls[ctrlIdx].CurrentState = newState

	sc := StateChange{
		ControlIdx: ctrlIdx,
		NewState:   newState,
		OldState:   old,
		Source:     source,
		RuleID:     ruleID,
		DeviceMs:   nowMs,
		SequenceID: e.sequenceID,
	}
	e.sequenceID++

	// Ring buffer: drop oldest if full
	if e.count >= len(e.changes) {
		e.head = (e.head + 1) % len(e.changes)
		e.count--
	}
	writeIdx := (e.head + e.count) % len(e.changes)
	e.changes[writeIdx] = sc
	e.count++
}

func evaluateCondition(op settings.RuleOperator, value, threshold float32) bool {
	switch op {
	case settings.OpLT:
		return value < threshold
	case settings.OpGT:
		return value > threshold
	case settings.OpLTE:
		return value <= threshold
	case settings.OpGTE:
		return value >= threshold
	case settings.OpEQ:
		return value == threshold
	case settings.OpNEQ:
		return value != threshold
	}
	return false
}
