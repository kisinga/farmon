// Package rules implements the edge rules engine.
// Evaluates field-threshold rules with priority resolution, cooldown,
// and auto-revert duration timers. All timing uses monotonic nowMs (ms since boot).
//
// Rules read from fields (conditions) and write to fields (actions).
// When the target field is an output field, the associated actuator fires.
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
	RevertAtMs    uint32
	HasDuration   bool
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

// SetControlFn is called when a rule writes to an output field and the actuator needs to fire.
type SetControlFn func(controlIdx, value uint8) bool

// Engine evaluates rules against field values and triggers actions.
type Engine struct {
	rules       []settings.Rule
	controls    [settings.MaxControls]ControlState
	lastFiredMs [settings.MaxRules]uint32 // per-rule cooldown tracker
	changes     [20]StateChange           // ring buffer
	head        int
	count       int
	sequenceID  uint16
	setControl  SetControlFn

	// FieldToControl maps field indices to control slot indices.
	// -1 means the field is not an output (not linked to a control).
	FieldToControl [settings.MaxFields]int8

	// FieldWritable marks which fields can be written by rules.
	// True for output fields and compute fields.
	FieldWritable [settings.MaxFields]bool
}

func New(setControl SetControlFn) *Engine {
	e := &Engine{setControl: setControl}
	for i := range e.FieldToControl {
		e.FieldToControl[i] = -1
	}
	return e
}

// ConfigureFieldMapping sets up the field→control dispatch table from control slots.
func (e *Engine) ConfigureFieldMapping(controls []settings.ControlSlot, controlCount uint8) {
	for i := range e.FieldToControl {
		e.FieldToControl[i] = -1
	}
	for i := range e.FieldWritable {
		e.FieldWritable[i] = false
	}
	for i := uint8(0); i < controlCount; i++ {
		c := &controls[i]
		if !c.Enabled() {
			continue
		}
		fi := c.FieldIndex
		if int(fi) < settings.MaxFields {
			e.FieldToControl[fi] = int8(i)
			e.FieldWritable[fi] = true
		}
	}
}

// MarkComputeWritable marks compute field indices as writable by rules.
func (e *Engine) MarkComputeWritable(computes []settings.ComputeSlot, count uint8) {
	for i := uint8(0); i < count; i++ {
		fi := computes[i].FieldIdx
		if int(fi) < settings.MaxFields {
			e.FieldWritable[fi] = true
		}
	}
}

// LoadRules replaces the current rule set and resets cooldown timers.
func (e *Engine) LoadRules(rules []settings.Rule) {
	e.rules = rules
	e.lastFiredMs = [settings.MaxRules]uint32{}
}

// Evaluate checks all rules against current field values.
// values is the unified field array (inputs + outputs + computed).
// nowMs is monotonic milliseconds since boot.
func (e *Engine) Evaluate(values []float32, nowMs uint32) {
	// Phase 1: revert any expired duration timers.
	e.revertExpired(values, nowMs)

	if len(e.rules) == 0 {
		return
	}

	// Phase 2: find the highest-priority triggered rule per target field.
	type winner struct {
		ruleIdx  int
		priority uint8
		valid    bool
	}
	// Use MaxFields for target indexing since rules now target fields.
	best := [settings.MaxFields]winner{}

	for i := range e.rules {
		r := &e.rules[i]
		if !r.Enabled {
			continue
		}
		if int(r.FieldIdx) >= len(values) {
			continue
		}
		if int(r.TargetFieldIdx) >= settings.MaxFields || !e.FieldWritable[r.TargetFieldIdx] {
			continue
		}

		// Cooldown: skip if fired too recently.
		if r.CooldownSec > 0 && e.lastFiredMs[i] > 0 {
			if elapsed := nowMs - e.lastFiredMs[i]; elapsed < uint32(r.CooldownSec)*1000 {
				continue
			}
		}

		// Skip manual override for output fields.
		if ctrlIdx := e.FieldToControl[r.TargetFieldIdx]; ctrlIdx >= 0 {
			cs := &e.controls[ctrlIdx]
			if cs.IsManual {
				if cs.ManualUntilMs == 0 || nowMs < cs.ManualUntilMs {
					continue
				}
				cs.IsManual = false
			}
		}

		result := evaluateCondition(r.Op, values[r.FieldIdx], r.Threshold)

		// Extra conditions (C2, C3, C4).
		hasFlags := [3]bool{r.HasC2, r.HasC3, r.HasC4}
		logicOps := [3]uint8{r.Logic12, r.Logic23, r.Logic34}
		for ci := 0; ci < settings.MaxExtraConditions; ci++ {
			if !hasFlags[ci] {
				continue
			}
			cr := evaluateExtra(&r.Extra[ci], values)
			if logicOps[ci] == 1 {
				result = result || cr
			} else {
				result = result && cr
			}
		}

		if result {
			b := &best[r.TargetFieldIdx]
			if !b.valid || r.Priority < b.priority {
				b.ruleIdx = i
				b.priority = r.Priority
				b.valid = true
			}
		}
	}

	// Phase 3: execute winning rules.
	for fi := uint8(0); fi < settings.MaxFields; fi++ {
		b := &best[fi]
		if !b.valid {
			continue
		}
		r := &e.rules[b.ruleIdx]

		ctrlIdx := e.FieldToControl[fi]
		if ctrlIdx >= 0 {
			// Output field — fire actuator if state changes.
			if e.controls[ctrlIdx].CurrentState == r.ActionValue {
				continue
			}
			if e.setControl != nil {
				if !e.setControl(uint8(ctrlIdx), r.ActionValue) {
					continue
				}
			}
			e.lastFiredMs[b.ruleIdx] = nowMs
			e.recordChange(uint8(ctrlIdx), r.ActionValue, TriggerRule, r.ID, nowMs)

			// Write to unified values array.
			if int(fi) < len(values) {
				values[fi] = float32(r.ActionValue)
			}

			// Start duration timer if configured.
			durMs := r.ActionDurationMs()
			if durMs > 0 {
				cs := &e.controls[ctrlIdx]
				cs.HasDuration = true
				cs.RevertAtMs = nowMs + durMs
			}
		} else {
			// Compute field — just write the value, no actuator.
			if int(fi) < len(values) {
				values[fi] = float32(r.ActionValue)
			}
			e.lastFiredMs[b.ruleIdx] = nowMs
		}
	}
}

// revertExpired reverts controls whose duration timer has elapsed.
func (e *Engine) revertExpired(values []float32, nowMs uint32) {
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
// ctrlIdx is the control slot index, value is the new state/value.
func (e *Engine) SetState(ctrlIdx, value uint8, source TriggerSource, ruleID uint8, nowMs uint32) {
	if e.setControl != nil {
		e.setControl(ctrlIdx, value)
	}
	e.controls[ctrlIdx].HasDuration = false
	e.recordChange(ctrlIdx, value, source, ruleID, nowMs)
}

// SetManualOverride locks a control in manual mode.
func (e *Engine) SetManualOverride(ctrlIdx uint8, durationMs, nowMs uint32) {
	cs := &e.controls[ctrlIdx]
	cs.IsManual = true
	cs.HasDuration = false
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

	if e.count >= len(e.changes) {
		e.head = (e.head + 1) % len(e.changes)
		e.count--
	}
	writeIdx := (e.head + e.count) % len(e.changes)
	e.changes[writeIdx] = sc
	e.count++
}

// evaluateExtra evaluates a compact extra condition (C2, C3, or C4).
// In the unified field model, all values (input + output + compute) are in the same array.
// The IsControl flag now means "compare against this field's value as uint8" (for backward compat
// with existing rule format where extra conditions referenced control states).
func evaluateExtra(c *settings.ExtraCondition, values []float32) bool {
	if c.FieldIdx == 0xFF {
		return false
	}
	threshold := float32(c.Threshold)
	if int(c.FieldIdx) >= len(values) {
		return false
	}
	return evaluateCondition(c.Op, values[c.FieldIdx], threshold)
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
