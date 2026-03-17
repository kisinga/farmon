package main

import (
	"encoding/binary"
	"fmt"
	"math"
)

const ruleBinarySize = 16

// operatorToFirmware maps operator strings to the firmware RuleOperator enum.
var operatorToFirmware = map[string]uint8{
	"<":  0, // OpLT
	">":  1, // OpGT
	"<=": 2, // OpLTE
	">=": 3, // OpGTE
	"==": 4, // OpEQ
	"!=": 5, // OpNEQ
}

// buildRuleBinaryV2 encodes a device_rules record into the 16-byte v2 wire format.
func buildRuleBinaryV2(r map[string]any) ([ruleBinarySize]byte, error) {
	var buf [ruleBinarySize]byte

	ruleID := toUint8(r["rule_id"])
	enabled := toBool(r["enabled"])
	op, ok := operatorToFirmware[toString(r["operator"])]
	if !ok {
		return buf, fmt.Errorf("unknown operator: %v", r["operator"])
	}
	fieldIdx := toUint8(r["field_idx"])
	threshold := float32(toFloat64(r["threshold"]))
	controlIdx := toUint8(r["control_idx"])
	actionState := toUint8(r["action_state"])
	cooldownSec := toUint16(r["cooldown_seconds"])
	priority := toUint8(r["priority"])

	// v2 compound condition
	secondFieldIdx := uint8(0xFF) // disabled by default
	var secondOp uint8
	var secondIsControl bool
	var secondThreshold uint8
	var hasSecond bool
	var logicOR bool
	var timeStart, timeEnd uint8

	if sfIdx := toInt(r["second_field_idx"]); sfIdx >= 0 {
		hasSecond = true
		secondFieldIdx = uint8(sfIdx)
		sop, _ := operatorToFirmware[toString(r["second_operator"])]
		secondOp = sop
		secondIsControl = toBool(r["second_is_control"])
		secondThreshold = toUint8(r["second_threshold"])
	}

	if toString(r["logic"]) == "or" {
		logicOR = true
	}

	if ts := toInt(r["time_start"]); ts >= 0 {
		timeStart = uint8(float64(ts) / 1.5)
	}
	if te := toInt(r["time_end"]); te >= 0 {
		timeEnd = uint8(float64(te) / 1.5)
	}

	// Encode bytes 0-11 (v1 compatible)
	buf[0] = ruleID
	buf[1] = (op & 0x07) << 4
	if enabled {
		buf[1] |= 0x80
	}
	if hasSecond {
		buf[1] |= 0x08
	}
	if logicOR {
		buf[1] |= 0x04
	}
	buf[2] = fieldIdx
	binary.LittleEndian.PutUint32(buf[3:7], math.Float32bits(threshold))
	buf[7] = controlIdx
	buf[8] = actionState
	binary.LittleEndian.PutUint16(buf[9:11], cooldownSec)
	buf[11] = priority

	// Encode bytes 12-15 (v2 extension)
	buf[12] = secondFieldIdx
	buf[13] = (secondOp & 0x07) << 4
	if secondIsControl {
		buf[13] |= 0x08
	}
	buf[14] = secondThreshold
	buf[15] = (timeStart&0x0F)<<4 | (timeEnd & 0x0F)

	return buf, nil
}

// buildRuleBatchPayload encodes multiple rules into a single downlink payload (fPort 30).
// Max 13 rules per payload (222 / 16 = 13).
func buildRuleBatchPayload(rules []map[string]any) ([]byte, error) {
	if len(rules) > 13 {
		return nil, fmt.Errorf("too many rules for single payload: %d (max 13)", len(rules))
	}
	payload := make([]byte, 0, len(rules)*ruleBinarySize)
	for i, r := range rules {
		bin, err := buildRuleBinaryV2(r)
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
