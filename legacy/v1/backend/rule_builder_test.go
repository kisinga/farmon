package main

import (
	"encoding/binary"
	"math"
	"testing"
)

func TestBuildRuleBinary_Basic(t *testing.T) {
	r := map[string]any{
		"rule_id":          float64(5),
		"enabled":          true,
		"operator":         ">",
		"field_idx":        float64(2),
		"threshold":        float64(25.5),
		"target_field_idx":      float64(1),
		"action_value":     float64(1),
		"cooldown_seconds": float64(300),
		"priority":         float64(10),
		"action_dur_x10s":  float64(6),
	}

	buf, err := buildRuleBinary(r, nil, true)
	if err != nil {
		t.Fatal(err)
	}

	// Byte 0: ID
	if buf[0] != 5 {
		t.Errorf("byte 0 (ID) = %d, want 5", buf[0])
	}
	// Byte 1: Enabled=1, Op=GT(1)<<4, no extras
	if buf[1]&0x80 == 0 {
		t.Error("enabled bit not set")
	}
	if (buf[1]>>4)&0x07 != 1 {
		t.Errorf("op = %d, want 1 (GT)", (buf[1]>>4)&0x07)
	}
	// No HasC2/C3/C4 flags
	if buf[1]&0x0E != 0 {
		t.Errorf("HasCx flags should be 0, got %02x", buf[1]&0x0E)
	}
	// Byte 2: FieldIdx
	if buf[2] != 2 {
		t.Errorf("byte 2 (FieldIdx) = %d, want 2", buf[2])
	}
	// Bytes 3-6: Threshold float32
	thresh := math.Float32frombits(binary.LittleEndian.Uint32(buf[3:7]))
	if math.Abs(float64(thresh-25.5)) > 0.001 {
		t.Errorf("threshold = %f, want 25.5", thresh)
	}
	// Byte 12: ActionDurX10s
	if buf[12] != 6 {
		t.Errorf("byte 12 (ActionDurX10s) = %d, want 6", buf[12])
	}
	// Unused condition slots should have 0xFF sentinel
	if buf[14] != 0xFF || buf[17] != 0xFF || buf[20] != 0xFF {
		t.Errorf("unused condition FieldIdx should be 0xFF: C2=%02x C3=%02x C4=%02x", buf[14], buf[17], buf[20])
	}
}

func TestBuildRuleBinary_WithExtras(t *testing.T) {
	r := map[string]any{
		"rule_id":          float64(1),
		"enabled":          true,
		"operator":         "<",
		"field_idx":        float64(0),
		"threshold":        float64(30.0),
		"target_field_idx":      float64(0),
		"action_value":     float64(1),
		"cooldown_seconds": float64(60),
		"priority":         float64(5),
		"action_dur_x10s":  float64(0),
	}
	extras := []ExtraConditionMap{
		{FieldIdx: 1, Operator: ">=", Threshold: 40, IsControl: false, Logic: "and"},
		{FieldIdx: 3, Operator: "==", Threshold: 1, IsControl: true, Logic: "or"},
	}

	buf, err := buildRuleBinary(r, extras, true)
	if err != nil {
		t.Fatal(err)
	}

	// HasC2 and HasC3 should be set, HasC4 should not
	if buf[1]&0x08 == 0 {
		t.Error("HasC2 not set")
	}
	if buf[1]&0x04 == 0 {
		t.Error("HasC3 not set")
	}
	if buf[1]&0x02 != 0 {
		t.Error("HasC4 should not be set")
	}

	// Logic ops: Logic12=AND(0), Logic23=OR(1)
	logicOps := buf[13]
	logic12 := (logicOps >> 4) & 0x03
	logic23 := (logicOps >> 2) & 0x03
	if logic12 != 0 {
		t.Errorf("Logic12 = %d, want 0 (AND)", logic12)
	}
	if logic23 != 1 {
		t.Errorf("Logic23 = %d, want 1 (OR)", logic23)
	}

	// C2: FieldIdx=1, Op=GTE(3), not control, Threshold=40
	if buf[14] != 1 {
		t.Errorf("C2 FieldIdx = %d, want 1", buf[14])
	}
	c2op := (buf[15] >> 5) & 0x07
	if c2op != 3 { // OpGTE
		t.Errorf("C2 Op = %d, want 3 (GTE)", c2op)
	}
	if buf[15]&0x10 != 0 {
		t.Error("C2 IsControl should be false")
	}
	if buf[16] != 40 {
		t.Errorf("C2 Threshold = %d, want 40", buf[16])
	}

	// C3: FieldIdx=3, Op=EQ(4), IsControl, Threshold=1
	if buf[17] != 3 {
		t.Errorf("C3 FieldIdx = %d, want 3", buf[17])
	}
	if buf[18]&0x10 == 0 {
		t.Error("C3 IsControl should be true")
	}
	if buf[19] != 1 {
		t.Errorf("C3 Threshold = %d, want 1", buf[19])
	}

	// C4 unused
	if buf[20] != 0xFF {
		t.Errorf("C4 FieldIdx should be 0xFF, got %02x", buf[20])
	}
}

func TestBuildRuleBinary_WindowActiveDisables(t *testing.T) {
	r := map[string]any{
		"rule_id":          float64(1),
		"enabled":          true,
		"operator":         "<",
		"field_idx":        float64(0),
		"threshold":        float64(30.0),
		"target_field_idx":      float64(0),
		"action_value":     float64(1),
		"cooldown_seconds": float64(0),
		"priority":         float64(0),
		"action_dur_x10s":  float64(0),
	}

	// window_active=false should disable the rule in binary
	buf, err := buildRuleBinary(r, nil, false)
	if err != nil {
		t.Fatal(err)
	}
	if buf[1]&0x80 != 0 {
		t.Error("enabled bit should be cleared when window_active is false")
	}
}

func TestBuildRuleBatchPayload_MaxRules(t *testing.T) {
	rules := make([]map[string]any, 10)
	for i := range rules {
		rules[i] = map[string]any{
			"rule_id": float64(i), "enabled": true, "operator": "<",
			"field_idx": float64(0), "threshold": float64(0),
			"target_field_idx": float64(0), "action_value": float64(0),
			"cooldown_seconds": float64(0), "priority": float64(0),
			"action_dur_x10s": float64(0),
		}
	}
	_, err := buildRuleBatchPayload(rules, nil, nil)
	if err == nil {
		t.Error("expected error for 10 rules (max 9)")
	}
}

func TestBuildRuleBatchPayload_PayloadSize(t *testing.T) {
	rules := make([]map[string]any, 3)
	for i := range rules {
		rules[i] = map[string]any{
			"rule_id": float64(i), "enabled": true, "operator": "<",
			"field_idx": float64(0), "threshold": float64(0),
			"target_field_idx": float64(0), "action_value": float64(0),
			"cooldown_seconds": float64(0), "priority": float64(0),
			"action_dur_x10s": float64(0),
		}
	}
	payload, err := buildRuleBatchPayload(rules, nil, nil)
	if err != nil {
		t.Fatal(err)
	}
	if len(payload) != 3*24 {
		t.Errorf("payload size = %d, want %d", len(payload), 3*24)
	}
}
