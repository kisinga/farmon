package settings

import (
	"math"
	"testing"
)

func TestRuleBinaryRoundTrip_NoExtras(t *testing.T) {
	r := Rule{
		ID: 7, FieldIdx: 3, TargetFieldIdx: 1, ActionValue: 1,
		Op: OpGT, Priority: 10, CooldownSec: 300,
		Threshold: 25.5, Enabled: true, ActionDurX10s: 6,
	}
	// Clear extra condition slots
	for i := range r.Extra {
		r.Extra[i].FieldIdx = 0xFF
	}

	var buf [RuleSize]byte
	n := r.ToBinary(buf[:])
	if n != RuleSize {
		t.Fatalf("ToBinary returned %d, want %d", n, RuleSize)
	}

	var r2 Rule
	if !r2.FromBinary(buf[:]) {
		t.Fatal("FromBinary failed")
	}

	if r2.ID != 7 || r2.FieldIdx != 3 || r2.TargetFieldIdx != 1 || r2.ActionValue != 1 {
		t.Errorf("basic fields mismatch: got ID=%d FieldIdx=%d TargetFieldIdx=%d ActionValue=%d", r2.ID, r2.FieldIdx, r2.TargetFieldIdx, r2.ActionValue)
	}
	if r2.Op != OpGT {
		t.Errorf("Op = %d, want %d", r2.Op, OpGT)
	}
	if !r2.Enabled {
		t.Error("Enabled should be true")
	}
	if r2.Priority != 10 {
		t.Errorf("Priority = %d, want 10", r2.Priority)
	}
	if r2.CooldownSec != 300 {
		t.Errorf("CooldownSec = %d, want 300", r2.CooldownSec)
	}
	if math.Abs(float64(r2.Threshold-25.5)) > 0.001 {
		t.Errorf("Threshold = %f, want 25.5", r2.Threshold)
	}
	if r2.ActionDurX10s != 6 {
		t.Errorf("ActionDurX10s = %d, want 6", r2.ActionDurX10s)
	}
	if r2.HasC2 || r2.HasC3 || r2.HasC4 {
		t.Error("HasC2/C3/C4 should be false")
	}
}

func TestRuleBinaryRoundTrip_FourConditions(t *testing.T) {
	r := Rule{
		ID: 1, FieldIdx: 0, Op: OpLT, Threshold: 30.0,
		TargetFieldIdx: 2, ActionValue: 1, CooldownSec: 60,
		Priority: 5, Enabled: true, ActionDurX10s: 12,
		HasC2: true, HasC3: true, HasC4: true,
		Logic12: 0, // AND
		Logic23: 1, // OR
		Logic34: 0, // AND
		Extra: [MaxExtraConditions]ExtraCondition{
			{FieldIdx: 1, Op: OpGTE, IsControl: false, Threshold: 40},
			{FieldIdx: 3, Op: OpEQ, IsControl: true, Threshold: 1},
			{FieldIdx: 5, Op: OpLTE, IsControl: false, Threshold: 200},
		},
	}

	var buf [RuleSize]byte
	r.ToBinary(buf[:])

	var r2 Rule
	if !r2.FromBinary(buf[:]) {
		t.Fatal("FromBinary failed")
	}

	if !r2.HasC2 || !r2.HasC3 || !r2.HasC4 {
		t.Errorf("HasC flags: C2=%v C3=%v C4=%v", r2.HasC2, r2.HasC3, r2.HasC4)
	}
	if r2.Logic12 != 0 || r2.Logic23 != 1 || r2.Logic34 != 0 {
		t.Errorf("Logic: 12=%d 23=%d 34=%d, want 0,1,0", r2.Logic12, r2.Logic23, r2.Logic34)
	}

	// C2
	if r2.Extra[0].FieldIdx != 1 || r2.Extra[0].Op != OpGTE || r2.Extra[0].IsControl || r2.Extra[0].Threshold != 40 {
		t.Errorf("C2 mismatch: %+v", r2.Extra[0])
	}
	// C3
	if r2.Extra[1].FieldIdx != 3 || r2.Extra[1].Op != OpEQ || !r2.Extra[1].IsControl || r2.Extra[1].Threshold != 1 {
		t.Errorf("C3 mismatch: %+v", r2.Extra[1])
	}
	// C4
	if r2.Extra[2].FieldIdx != 5 || r2.Extra[2].Op != OpLTE || r2.Extra[2].IsControl || r2.Extra[2].Threshold != 200 {
		t.Errorf("C4 mismatch: %+v", r2.Extra[2])
	}
}

func TestRuleSize(t *testing.T) {
	if RuleSize != 24 {
		t.Errorf("RuleSize = %d, want 24", RuleSize)
	}
}

func TestFromBinaryTooShort(t *testing.T) {
	var r Rule
	if r.FromBinary(make([]byte, 23)) {
		t.Error("FromBinary should fail with 23 bytes")
	}
}
