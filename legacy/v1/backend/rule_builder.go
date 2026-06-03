package main

import (
	"encoding/binary"
	"fmt"
	"math"
)

const ruleBinarySize = 24

// operatorToFirmware maps operator strings to the firmware RuleOperator enum.
var operatorToFirmware = map[string]uint8{
	"<":  0, // OpLT
	">":  1, // OpGT
	"<=": 2, // OpLTE
	">=": 3, // OpGTE
	"==": 4, // OpEQ
	"!=": 5, // OpNEQ
}

// ExtraConditionMap represents a single extra condition from the DB JSON array.
type ExtraConditionMap struct {
	FieldIdx  int
	Operator  string
	Threshold uint8
	IsControl bool
	Logic     string // "and" or "or"
}

// buildRuleBinary encodes a device_rules record into the 24-byte v4 wire format.
//
// Binary layout (24 bytes):
//
//	[0]     ID
//	[1]     Flags: bit7=Enabled, bits6-4=Op(3), bit3=HasC2, bit2=HasC3, bit1=HasC4
//	[2]     FieldIdx (primary condition)
//	[3-6]   Threshold float32 LE (primary condition)
//	[7]     TargetFieldIdx — field to write to (output field → actuator fires)
//	[8]     ActionValue — value to write (0/1 binary, 0-255 analog/PWM)
//	[9-10]  CooldownSec uint16 LE
//	[11]    Priority
//	[12]    ActionDurX10s
//	[13]    LogicOps: bits5-4=Logic12, bits3-2=Logic23, bits1-0=Logic34
//	[14-16] C2: FieldIdx, OpFlags, Threshold
//	[17-19] C3: FieldIdx, OpFlags, Threshold
//	[20-22] C4: FieldIdx, OpFlags, Threshold
//	[23]    Reserved
func buildRuleBinary(r map[string]any, extras []ExtraConditionMap, windowActive bool) ([ruleBinarySize]byte, error) {
	var buf [ruleBinarySize]byte

	ruleID := toUint8(r["rule_id"])
	enabled := toBool(r["enabled"]) && windowActive
	op, ok := operatorToFirmware[toString(r["operator"])]
	if !ok {
		return buf, fmt.Errorf("unknown operator: %v", r["operator"])
	}
	fieldIdx := toUint8(r["field_idx"])
	threshold := float32(toFloat64(r["threshold"]))
	targetFieldIdx := toUint8(r["target_field_idx"])
	actionValue := toUint8(r["action_value"])
	cooldownSec := toUint16(r["cooldown_seconds"])
	priority := toUint8(r["priority"])
	actionDur := toUint8(r["action_dur_x10s"])

	buf[0] = ruleID
	buf[1] = (op & 0x07) << 4
	if enabled {
		buf[1] |= 0x80
	}
	buf[2] = fieldIdx
	binary.LittleEndian.PutUint32(buf[3:7], math.Float32bits(threshold))
	buf[7] = targetFieldIdx
	buf[8] = actionValue
	binary.LittleEndian.PutUint16(buf[9:11], cooldownSec)
	buf[11] = priority
	buf[12] = actionDur

	// Encode extra conditions (C2, C3, C4)
	var logicOps uint8
	for i := 0; i < 3 && i < len(extras); i++ {
		c := &extras[i]
		cop, ok := operatorToFirmware[c.Operator]
		if !ok {
			return buf, fmt.Errorf("extra condition %d: unknown operator: %s", i+2, c.Operator)
		}
		// Set HasCx flag in byte 1
		buf[1] |= 1 << uint(3-i) // bit3=HasC2, bit2=HasC3, bit1=HasC4
		// Logic ops: 2 bits per junction
		if c.Logic == "or" {
			logicOps |= 1 << uint((2-i)*2) // bits5-4=Logic12, bits3-2=Logic23, bits1-0=Logic34
		}
		// Condition bytes
		off := 14 + i*3
		buf[off] = uint8(c.FieldIdx)
		buf[off+1] = (cop & 0x07) << 5
		if c.IsControl {
			buf[off+1] |= 0x10
		}
		buf[off+2] = c.Threshold
	}
	buf[13] = logicOps

	// Fill unused condition slots with 0xFF sentinel
	for i := len(extras); i < 3; i++ {
		buf[14+i*3] = 0xFF
	}

	buf[23] = 0 // reserved
	return buf, nil
}

// buildRuleBatchPayload encodes multiple rules into a single downlink payload (fPort 30).
// Max 9 rules per payload (222 / 24 = 9).
func buildRuleBatchPayload(rules []map[string]any, extras [][]ExtraConditionMap, windowActive []bool) ([]byte, error) {
	if len(rules) > 9 {
		return nil, fmt.Errorf("too many rules for single payload: %d (max 9)", len(rules))
	}
	payload := make([]byte, 0, len(rules)*ruleBinarySize)
	for i, r := range rules {
		var ec []ExtraConditionMap
		if i < len(extras) {
			ec = extras[i]
		}
		wa := true
		if i < len(windowActive) {
			wa = windowActive[i]
		}
		bin, err := buildRuleBinary(r, ec, wa)
		if err != nil {
			return nil, fmt.Errorf("rule %d: %w", i, err)
		}
		payload = append(payload, bin[:]...)
	}
	return payload, nil
}

func toUint8(v any) uint8 {
	return uint8(toFloat64(v))
}

func toUint16(v any) uint16 {
	return uint16(toFloat64(v))
}

func toInt(v any) int {
	if v == nil {
		return -1
	}
	f := toFloat64(v)
	return int(f)
}

func toBool(v any) bool {
	if b, ok := v.(bool); ok {
		return b
	}
	return false
}

func toString(v any) string {
	if s, ok := v.(string); ok {
		return s
	}
	return ""
}
