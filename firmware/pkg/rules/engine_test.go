package rules

import (
	"testing"

	"github.com/farmon/firmware/pkg/settings"
)

func makeEngine() *Engine {
	return New(func(ctrlIdx, stateIdx uint8) bool { return true })
}

func TestEvaluateSingleCondition(t *testing.T) {
	e := makeEngine()
	e.LoadRules([]settings.Rule{{
		ID: 0, Enabled: true, FieldIdx: 0, Op: settings.OpGT,
		Threshold: 25.0, ControlIdx: 0, ActionState: 1,
	}})

	// Value 30 > 25 → should fire
	e.Evaluate([]float32{30.0}, []uint8{0}, 1000)
	if e.controls[0].CurrentState != 1 {
		t.Error("rule should have fired: 30 > 25")
	}
}

func TestEvaluateSingleCondition_NotTriggered(t *testing.T) {
	e := makeEngine()
	e.LoadRules([]settings.Rule{{
		ID: 0, Enabled: true, FieldIdx: 0, Op: settings.OpGT,
		Threshold: 25.0, ControlIdx: 0, ActionState: 1,
	}})

	e.Evaluate([]float32{20.0}, []uint8{0}, 1000)
	if e.controls[0].CurrentState != 0 {
		t.Error("rule should NOT have fired: 20 > 25 is false")
	}
}

func TestEvaluateFourConditions_AllAND(t *testing.T) {
	e := makeEngine()
	r := settings.Rule{
		ID: 0, Enabled: true, FieldIdx: 0, Op: settings.OpGT,
		Threshold: 20.0, ControlIdx: 0, ActionState: 1,
		HasC2: true, HasC3: true, HasC4: true,
		Logic12: 0, Logic23: 0, Logic34: 0, // all AND
		Extra: [settings.MaxExtraConditions]settings.ExtraCondition{
			{FieldIdx: 1, Op: settings.OpLT, Threshold: 50},
			{FieldIdx: 2, Op: settings.OpGTE, Threshold: 10},
			{FieldIdx: 3, Op: settings.OpEQ, Threshold: 1},
		},
	}
	e.LoadRules([]settings.Rule{r})

	// All conditions true: 30>20 AND 40<50 AND 15>=10 AND 1==1
	e.Evaluate([]float32{30, 40, 15, 1}, []uint8{0}, 1000)
	if e.controls[0].CurrentState != 1 {
		t.Error("all AND conditions true, rule should fire")
	}
}

func TestEvaluateFourConditions_AllAND_OneFails(t *testing.T) {
	e := makeEngine()
	r := settings.Rule{
		ID: 0, Enabled: true, FieldIdx: 0, Op: settings.OpGT,
		Threshold: 20.0, ControlIdx: 0, ActionState: 1,
		HasC2: true, HasC3: true, HasC4: true,
		Logic12: 0, Logic23: 0, Logic34: 0,
		Extra: [settings.MaxExtraConditions]settings.ExtraCondition{
			{FieldIdx: 1, Op: settings.OpLT, Threshold: 50},
			{FieldIdx: 2, Op: settings.OpGTE, Threshold: 10},
			{FieldIdx: 3, Op: settings.OpEQ, Threshold: 1},
		},
	}
	e.LoadRules([]settings.Rule{r})

	// C4 fails: 0 == 1 is false
	e.Evaluate([]float32{30, 40, 15, 0}, []uint8{0}, 1000)
	if e.controls[0].CurrentState != 0 {
		t.Error("one AND condition false, rule should NOT fire")
	}
}

func TestEvaluateFourConditions_AllOR(t *testing.T) {
	e := makeEngine()
	r := settings.Rule{
		ID: 0, Enabled: true, FieldIdx: 0, Op: settings.OpGT,
		Threshold: 100.0, ControlIdx: 0, ActionState: 1,
		HasC2: true, HasC3: true, HasC4: true,
		Logic12: 1, Logic23: 1, Logic34: 1, // all OR
		Extra: [settings.MaxExtraConditions]settings.ExtraCondition{
			{FieldIdx: 1, Op: settings.OpGT, Threshold: 100},
			{FieldIdx: 2, Op: settings.OpGT, Threshold: 100},
			{FieldIdx: 3, Op: settings.OpEQ, Threshold: 1}, // this one is true
		},
	}
	e.LoadRules([]settings.Rule{r})

	// Only C4 true: ((false OR false) OR false) OR true = true
	e.Evaluate([]float32{5, 5, 5, 1}, []uint8{0}, 1000)
	if e.controls[0].CurrentState != 1 {
		t.Error("one OR condition true, rule should fire")
	}
}

func TestEvaluateMixedLogic(t *testing.T) {
	e := makeEngine()
	// (C1 AND C2) OR C3 AND C4
	// = ((true AND true) OR false) AND true = (true OR false) AND true = true
	r := settings.Rule{
		ID: 0, Enabled: true, FieldIdx: 0, Op: settings.OpGT,
		Threshold: 10.0, ControlIdx: 0, ActionState: 1,
		HasC2: true, HasC3: true, HasC4: true,
		Logic12: 0, // AND
		Logic23: 1, // OR
		Logic34: 0, // AND
		Extra: [settings.MaxExtraConditions]settings.ExtraCondition{
			{FieldIdx: 1, Op: settings.OpGT, Threshold: 5},   // true
			{FieldIdx: 2, Op: settings.OpGT, Threshold: 100}, // false
			{FieldIdx: 3, Op: settings.OpEQ, Threshold: 1},   // true
		},
	}
	e.LoadRules([]settings.Rule{r})

	e.Evaluate([]float32{20, 10, 5, 1}, []uint8{0}, 1000)
	if e.controls[0].CurrentState != 1 {
		t.Error("((true AND true) OR false) AND true should fire")
	}
}

func TestEvaluateControlStateCondition(t *testing.T) {
	e := makeEngine()
	r := settings.Rule{
		ID: 0, Enabled: true, FieldIdx: 0, Op: settings.OpGT,
		Threshold: 10.0, ControlIdx: 1, ActionState: 1,
		HasC2: true, Logic12: 0, // AND
		Extra: [settings.MaxExtraConditions]settings.ExtraCondition{
			{FieldIdx: 0, Op: settings.OpEQ, IsControl: true, Threshold: 0}, // control 0 == 0
			{FieldIdx: 0xFF}, // disabled
			{FieldIdx: 0xFF}, // disabled
		},
	}
	e.LoadRules([]settings.Rule{r})

	// Sensor 0 = 20 > 10 (true), control 0 state = 0 == 0 (true)
	e.Evaluate([]float32{20}, []uint8{0, 0}, 1000)
	if e.controls[1].CurrentState != 1 {
		t.Error("control state condition should pass")
	}
}

func TestEvaluateDisabledRule(t *testing.T) {
	e := makeEngine()
	e.LoadRules([]settings.Rule{{
		ID: 0, Enabled: false, FieldIdx: 0, Op: settings.OpGT,
		Threshold: 10.0, ControlIdx: 0, ActionState: 1,
	}})

	e.Evaluate([]float32{30.0}, []uint8{0}, 1000)
	if e.controls[0].CurrentState != 0 {
		t.Error("disabled rule should not fire")
	}
}
