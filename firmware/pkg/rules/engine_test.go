package rules

import (
	"testing"

	"github.com/farmon/firmware/pkg/settings"
)

func makeEngine() *Engine {
	return New(func(ctrlIdx, value uint8) bool { return true })
}

// setupOutputField configures a control slot and maps its field index.
func setupOutputField(e *Engine, ctrlIdx uint8, fieldIdx uint8) {
	controls := [settings.MaxControls]settings.ControlSlot{}
	controls[ctrlIdx] = settings.ControlSlot{
		PinIndex:   6,
		StateCount: 2,
		Flags:      0x01, // enabled
		FieldIndex: fieldIdx,
	}
	e.ConfigureFieldMapping(controls[:], ctrlIdx+1)
}

func TestEvaluateSingleCondition(t *testing.T) {
	e := makeEngine()
	setupOutputField(e, 0, 10) // control 0 → field 10
	e.LoadRules([]settings.Rule{{
		ID: 0, Enabled: true, FieldIdx: 0, Op: settings.OpGT,
		Threshold: 25.0, TargetFieldIdx: 10, ActionValue: 1,
	}})

	values := make([]float32, settings.MaxFields)
	values[0] = 30.0 // sensor reading
	e.Evaluate(values[:], 1000)
	if e.controls[0].CurrentState != 1 {
		t.Error("rule should have fired: 30 > 25")
	}
	if values[10] != 1.0 {
		t.Errorf("output field should be 1.0, got %f", values[10])
	}
}

func TestEvaluateSingleCondition_NotTriggered(t *testing.T) {
	e := makeEngine()
	setupOutputField(e, 0, 10)
	e.LoadRules([]settings.Rule{{
		ID: 0, Enabled: true, FieldIdx: 0, Op: settings.OpGT,
		Threshold: 25.0, TargetFieldIdx: 10, ActionValue: 1,
	}})

	values := make([]float32, settings.MaxFields)
	values[0] = 20.0
	e.Evaluate(values[:], 1000)
	if e.controls[0].CurrentState != 0 {
		t.Error("rule should NOT have fired: 20 > 25 is false")
	}
}

func TestEvaluateFourConditions_AllAND(t *testing.T) {
	e := makeEngine()
	setupOutputField(e, 0, 10)
	r := settings.Rule{
		ID: 0, Enabled: true, FieldIdx: 0, Op: settings.OpGT,
		Threshold: 20.0, TargetFieldIdx: 10, ActionValue: 1,
		HasC2: true, HasC3: true, HasC4: true,
		Logic12: 0, Logic23: 0, Logic34: 0,
		Extra: [settings.MaxExtraConditions]settings.ExtraCondition{
			{FieldIdx: 1, Op: settings.OpLT, Threshold: 50},
			{FieldIdx: 2, Op: settings.OpGTE, Threshold: 10},
			{FieldIdx: 3, Op: settings.OpEQ, Threshold: 1},
		},
	}
	e.LoadRules([]settings.Rule{r})

	values := make([]float32, settings.MaxFields)
	values[0], values[1], values[2], values[3] = 30, 40, 15, 1
	e.Evaluate(values[:], 1000)
	if e.controls[0].CurrentState != 1 {
		t.Error("all AND conditions true, rule should fire")
	}
}

func TestEvaluateFourConditions_AllAND_OneFails(t *testing.T) {
	e := makeEngine()
	setupOutputField(e, 0, 10)
	r := settings.Rule{
		ID: 0, Enabled: true, FieldIdx: 0, Op: settings.OpGT,
		Threshold: 20.0, TargetFieldIdx: 10, ActionValue: 1,
		HasC2: true, HasC3: true, HasC4: true,
		Logic12: 0, Logic23: 0, Logic34: 0,
		Extra: [settings.MaxExtraConditions]settings.ExtraCondition{
			{FieldIdx: 1, Op: settings.OpLT, Threshold: 50},
			{FieldIdx: 2, Op: settings.OpGTE, Threshold: 10},
			{FieldIdx: 3, Op: settings.OpEQ, Threshold: 1},
		},
	}
	e.LoadRules([]settings.Rule{r})

	values := make([]float32, settings.MaxFields)
	values[0], values[1], values[2], values[3] = 30, 40, 15, 0 // C4 fails
	e.Evaluate(values[:], 1000)
	if e.controls[0].CurrentState != 0 {
		t.Error("one AND condition false, rule should NOT fire")
	}
}

func TestEvaluateFourConditions_AllOR(t *testing.T) {
	e := makeEngine()
	setupOutputField(e, 0, 10)
	r := settings.Rule{
		ID: 0, Enabled: true, FieldIdx: 0, Op: settings.OpGT,
		Threshold: 100.0, TargetFieldIdx: 10, ActionValue: 1,
		HasC2: true, HasC3: true, HasC4: true,
		Logic12: 1, Logic23: 1, Logic34: 1,
		Extra: [settings.MaxExtraConditions]settings.ExtraCondition{
			{FieldIdx: 1, Op: settings.OpGT, Threshold: 100},
			{FieldIdx: 2, Op: settings.OpGT, Threshold: 100},
			{FieldIdx: 3, Op: settings.OpEQ, Threshold: 1},
		},
	}
	e.LoadRules([]settings.Rule{r})

	values := make([]float32, settings.MaxFields)
	values[0], values[1], values[2], values[3] = 5, 5, 5, 1 // only C4 true
	e.Evaluate(values[:], 1000)
	if e.controls[0].CurrentState != 1 {
		t.Error("one OR condition true, rule should fire")
	}
}

func TestEvaluateDisabledRule(t *testing.T) {
	e := makeEngine()
	setupOutputField(e, 0, 10)
	e.LoadRules([]settings.Rule{{
		ID: 0, Enabled: false, FieldIdx: 0, Op: settings.OpGT,
		Threshold: 10.0, TargetFieldIdx: 10, ActionValue: 1,
	}})

	values := make([]float32, settings.MaxFields)
	values[0] = 30.0
	e.Evaluate(values[:], 1000)
	if e.controls[0].CurrentState != 0 {
		t.Error("disabled rule should not fire")
	}
}

func TestEvaluateComputeFieldTarget(t *testing.T) {
	e := makeEngine()
	// Field 5 is a compute field (writable but not an output)
	e.FieldWritable[5] = true
	e.LoadRules([]settings.Rule{{
		ID: 0, Enabled: true, FieldIdx: 0, Op: settings.OpGT,
		Threshold: 10.0, TargetFieldIdx: 5, ActionValue: 255,
	}})

	values := make([]float32, settings.MaxFields)
	values[0] = 20.0
	e.Evaluate(values[:], 1000)
	if values[5] != 255.0 {
		t.Errorf("compute field should be 255.0, got %f", values[5])
	}
}

func TestEvaluateAnalogPWMAction(t *testing.T) {
	e := makeEngine()
	setupOutputField(e, 0, 10) // PWM fan on field 10
	e.LoadRules([]settings.Rule{{
		ID: 0, Enabled: true, FieldIdx: 0, Op: settings.OpGT,
		Threshold: 30.0, TargetFieldIdx: 10, ActionValue: 191, // 75% PWM
	}})

	values := make([]float32, settings.MaxFields)
	values[0] = 35.0 // temp > 30
	e.Evaluate(values[:], 1000)
	if e.controls[0].CurrentState != 191 {
		t.Errorf("control state should be 191, got %d", e.controls[0].CurrentState)
	}
	if values[10] != 191.0 {
		t.Errorf("output field should be 191.0, got %f", values[10])
	}
}
