// Package rules implements the edge rules engine.
// Evaluates sensor-threshold rules with priority resolution, cooldown,
// and auto-revert duration timers. All timing uses monotonic nowMs (ms since boot).
package rules

import (
	"github.com/farmon/firmware/pkg/settings"
)

const StateChangeSize = 11 // bytes per state change event

type TriggerSource uint8

const (
	TriggerBoot     TriggerSource = 0
	TriggerRule     TriggerSource = 1
	TriggerManual   TriggerSource = 2
	TriggerDownlink TriggerSource = 3
	TriggerRevert   TriggerSource = 4 // auto-revert after action duration expires
)

// ControlState tracks the current state of a control output.
type ControlState struct {
	CurrentState  uint8
	IsManual      bool
	ManualUntilMs uint32
	// Duration timer: when a rule fires with ActionDurX10s > 0, the control
	// reverts to state 0 after the timer expires.
	RevertAtMs  uint32
	HasDuration bool
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
	rules        []settings.Rule
	controls     [settings.MaxControls]ControlState
	lastFiredMs  [settings.MaxRules]uint32 // per-rule cooldown tracker
	changes      [20]StateChange           // ring buffer
	head         int
	count        int
	sequenceID   uint16
	setControl   SetControlFn
}

func New(setControl SetControlFn) *Engine {
	return &Engine{setControl: setControl}
}

// LoadRules replaces the current rule set and resets cooldown timers.
func (e *Engine) LoadRules(rules []settings.Rule) {
	e.rules = rules
	e.lastFiredMs = [settings.MaxRules]uint32{}
}

// Evaluate checks all rules against current sensor values and control states.
// nowMs is monotonic milliseconds since boot.
func (e *Engine) Evaluate(values []float32, controlStates []uint8, nowMs uint32) {
	// Phase 1: revert any expired duration timers.
	e.revertExpired(nowMs)

	if len(e.rules) == 0 {
		return
	}

	// Phase 2: find the highest-priority triggered rule per control.
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
		// Cooldown: skip if fired too recently.
		if r.CooldownSec > 0 && e.lastFiredMs[i] > 0 {
			if elapsed := nowMs - e.lastFiredMs[i]; elapsed < uint32(r.CooldownSec)*1000 {
				continue
			}
		}
		// Skip manual override.
		cs := &e.controls[r.ControlIdx]
		if cs.IsManual {
			if cs.ManualUntilMs == 0 || nowMs < cs.ManualUntilMs {
				continue
			}
			cs.IsManual = false
		}

		primaryResult := evaluateCondition(r.Op, values[r.FieldIdx], r.Threshold)

		// Compound condition.
		if r.HasSecond && r.SecondFieldIdx != 0xFF {
			secondResult := e.evaluateSecondCondition(r, values, controlStates)
			if r.LogicOR {
				primaryResult = primaryResult || secondResult
			} else {
				primaryResult = primaryResult && secondResult
			}
		}

		if primaryResult {
			b := &best[r.ControlIdx]
			if !b.valid || r.Priority < b.priority {
				b.ruleIdx = i
				b.priority = r.Priority
				b.valid = true
			}
		}
	}

	// Phase 3: execute winning rules where state actually changes.
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

		e.lastFiredMs[b.ruleIdx] = nowMs
		e.recordChange(ctrlIdx, r.ActionState, TriggerRule, r.ID, nowMs)

		// Start duration timer if configured.
		durMs := r.ActionDurationMs()
		if durMs > 0 {
			cs := &e.controls[ctrlIdx]
			cs.HasDuration = true
			cs.RevertAtMs = nowMs + durMs
		}
	}
}

// revertExpired reverts controls whose duration timer has elapsed.
func (e *Engine) revertExpired(nowMs uint32) {
	for i := uint8(0); i < settings.MaxControls; i++ {
		cs := &e.controls[i]
		if !cs.HasDuration {
			continue
		}
		if nowMs < cs.RevertAtMs {
			continue
		}
		cs.HasDuration = false
		if cs.CurrentState == 0 {
			continue // already off
		}
		if e.setControl != nil {
			e.setControl(i, 0)
		}
		e.recordChange(i, 0, TriggerRevert, 0, nowMs)
	}
}

// SetState allows external state changes (downlinks, manual).
func (e *Engine) SetState(ctrlIdx, stateIdx uint8, source TriggerSource, ruleID uint8, nowMs uint32) {
	if e.setControl != nil {
		e.setControl(ctrlIdx, stateIdx)
	}
	// External state change cancels any running duration timer.
	e.controls[ctrlIdx].HasDuration = false
	e.recordChange(ctrlIdx, stateIdx, source, ruleID, nowMs)
}

// SetManualOverride locks a control in manual mode.
func (e *Engine) SetManualOverride(ctrlIdx uint8, durationMs, nowMs uint32) {
	cs := &e.controls[ctrlIdx]
	cs.IsManual = true
	cs.HasDuration = false // manual override cancels duration timer
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

// GetControlStates returns a snapshot of the current state index for each control slot.
func (e *Engine) GetControlStates() []uint8 {
	out := make([]uint8, settings.MaxControls)
	for i := range out {
		out[i] = e.controls[i].CurrentState
	}
	return out
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

// evaluateSecondCondition evaluates the compound (second) condition of a rule.
func (e *Engine) evaluateSecondCondition(r *settings.Rule, values []float32, controlStates []uint8) bool {
	threshold := float32(r.SecondThreshold)
	if r.SecondIsControl {
		if int(r.SecondFieldIdx) >= len(controlStates) {
			return false
		}
		return evaluateCondition(r.SecondOp, float32(controlStates[r.SecondFieldIdx]), threshold)
	}
	if int(r.SecondFieldIdx) >= len(values) {
		return false
	}
	return evaluateCondition(r.SecondOp, values[r.SecondFieldIdx], threshold)
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
