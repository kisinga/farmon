package main

import (
	"encoding/binary"
	"fmt"
	"math"
	"strconv"
	"strings"
)

// DecodeResult holds the decoded payload fields.
type DecodeResult struct {
	Fields map[string]any `json:"fields"`
}

// DecodeWithRules interprets a decode_rules record against raw payload.
func DecodeWithRules(format string, config map[string]any, profileFields []ProfileField, payload []byte) (*DecodeResult, error) {
	switch format {
	case "text_kv":
		return decodeTextKV(config, payload)
	case "binary_indexed":
		return decodeBinaryIndexed(config, profileFields, payload)
	case "binary_indexed_float32":
		return decodeBinaryIndexedFloat32(config, profileFields, payload)
	case "binary_frames":
		return decodeBinaryFrames(config, payload)
	case "binary_state_change":
		return decodeBinaryStateChange(config, payload)
	default:
		return nil, fmt.Errorf("unknown decode format: %s", format)
	}
}

// decodeTextKV parses text payloads like "pd:42,tv:1523.7".
func decodeTextKV(config map[string]any, payload []byte) (*DecodeResult, error) {
	text := string(payload)
	separator := getConfigString(config, "separator", ",")
	kvSeparator := getConfigString(config, "kv_separator", ":")

	out := make(map[string]any)
	for _, pair := range strings.Split(text, separator) {
		pair = strings.TrimSpace(pair)
		if pair == "" {
			continue
		}
		idx := strings.Index(pair, kvSeparator)
		if idx < 0 {
			continue
		}
		key := strings.TrimSpace(pair[:idx])
		value := strings.TrimSpace(pair[idx+len(kvSeparator):])
		if num, err := strconv.ParseFloat(value, 64); err == nil {
			out[key] = num
		} else {
			out[key] = value
		}
	}
	return &DecodeResult{Fields: out}, nil
}

// decodeBinaryIndexed parses payloads with header + repeated (field_idx, value) entries.
// Maps field_idx to profileFields[sort_order].key.
func decodeBinaryIndexed(config map[string]any, profileFields []ProfileField, payload []byte) (*DecodeResult, error) {
	headerBytes := getConfigInt(config, "header_bytes", 1)
	entrySize := getConfigInt(config, "entry_size", 5)

	// Parse entry layout
	layoutRaw, _ := config["entry_layout"].([]any)
	if len(layoutRaw) == 0 {
		return nil, fmt.Errorf("binary_indexed: entry_layout required")
	}
	layout := parseLayout(layoutRaw)

	indexKey := getConfigString(config, "index_key", "_field_idx")
	valueKey := getConfigString(config, "value_key", "_value")

	// Build field_idx → key map from profile fields
	idxToKey := make(map[int]string)
	for _, f := range profileFields {
		idxToKey[f.SortOrder] = f.Key
	}

	out := make(map[string]any)
	data := payload[headerBytes:]
	for len(data) >= entrySize {
		entry := data[:entrySize]
		data = data[entrySize:]

		parsed := decodeLayoutEntry(entry, layout)
		fieldIdx := int(toFloat64(parsed[indexKey]))
		value := parsed[valueKey]

		key, ok := idxToKey[fieldIdx]
		if !ok {
			key = fmt.Sprintf("field_%d", fieldIdx)
		}
		out[key] = value
	}
	return &DecodeResult{Fields: out}, nil
}

// decodeBinaryIndexedFloat32 parses the compact telemetry format produced by pkg/node sendTelemetry().
// Wire format: [count:1][field_idx:1][float32_le:4] × count
// Maps field_idx → profile field key via sort_order (sort_order == field_index by convention).
func decodeBinaryIndexedFloat32(_ map[string]any, profileFields []ProfileField, payload []byte) (*DecodeResult, error) {
	if len(payload) < 1 {
		return nil, fmt.Errorf("binary_indexed_float32: empty payload")
	}
	count := int(payload[0])
	entrySize := 5 // 1-byte index + 4-byte float32
	if len(payload) < 1+count*entrySize {
		return nil, fmt.Errorf("binary_indexed_float32: payload too short: have %d, need %d for count=%d", len(payload), 1+count*entrySize, count)
	}

	idxToKey := make(map[int]string, len(profileFields))
	for _, f := range profileFields {
		idxToKey[f.SortOrder] = f.Key
	}

	out := make(map[string]any, count)
	for i := 0; i < count; i++ {
		off := 1 + i*entrySize
		idx := int(payload[off])
		bits := binary.LittleEndian.Uint32(payload[off+1:])
		value := float64(math.Float32frombits(bits))
		key, ok := idxToKey[idx]
		if !ok {
			key = fmt.Sprintf("field_%d", idx)
		}
		out[key] = value
	}
	return &DecodeResult{Fields: out}, nil
}

// decodeBinaryFrames parses frame-based protocols (e.g., SenseCAP).
func decodeBinaryFrames(config map[string]any, payload []byte) (*DecodeResult, error) {
	frameSize := getConfigInt(config, "frame_size", 7)
	layoutRaw, _ := config["layout"].([]any)
	if len(layoutRaw) == 0 {
		return nil, fmt.Errorf("binary_frames: layout required")
	}
	layout := parseLayout(layoutRaw)

	dispatchKey := getConfigString(config, "dispatch_key", "_type_id")
	valueKey := getConfigString(config, "value_key", "_raw_value")
	mappingsRaw, _ := config["mappings"].(map[string]any)

	out := make(map[string]any)
	data := payload
	for len(data) >= frameSize {
		frame := data[:frameSize]
		data = data[frameSize:]

		parsed := decodeLayoutEntry(frame, layout)
		dispatchVal := fmt.Sprintf("%d", int(toFloat64(parsed[dispatchKey])))

		mappingRaw, ok := mappingsRaw[dispatchVal]
		if !ok {
			continue
		}
		mapping, ok := mappingRaw.(map[string]any)
		if !ok {
			continue
		}

		key, _ := mapping["key"].(string)
		if key == "" {
			continue
		}

		rawValue := toFloat64(parsed[valueKey])
		if transformExpr, ok := mapping["transform"].(string); ok && transformExpr != "" {
			rawValue = applyTransform(rawValue, transformExpr)
		}
		out[key] = rawValue
	}
	return &DecodeResult{Fields: out}, nil
}

// decodeBinaryStateChange parses state change payloads (fixed-size records).
func decodeBinaryStateChange(config map[string]any, payload []byte) (*DecodeResult, error) {
	recordSize := getConfigInt(config, "record_size", 11)
	layoutRaw, _ := config["layout"].([]any)
	if len(layoutRaw) == 0 {
		return nil, fmt.Errorf("binary_state_change: layout required")
	}
	layout := parseLayout(layoutRaw)

	sourceMapRaw, _ := config["source_map"].(map[string]any)
	sourceMap := make(map[string]string)
	for k, v := range sourceMapRaw {
		if s, ok := v.(string); ok {
			sourceMap[k] = s
		}
	}

	if len(payload) < recordSize {
		return nil, fmt.Errorf("payload too short for state change: need %d, got %d", recordSize, len(payload))
	}

	var stateChanges []any
	data := payload
	for len(data) >= recordSize {
		record := data[:recordSize]
		data = data[recordSize:]

		parsed := decodeLayoutEntry(record, layout)

		// Resolve source name
		if srcID, ok := parsed["source_id"]; ok {
			srcKey := fmt.Sprintf("%d", int(toFloat64(srcID)))
			if name, ok := sourceMap[srcKey]; ok {
				parsed["source"] = name
			} else {
				parsed["source"] = "UNKNOWN"
			}
		}

		stateChanges = append(stateChanges, parsed)
	}

	return &DecodeResult{Fields: map[string]any{"stateChanges": stateChanges}}, nil
}

// --- Layout parsing and binary field extraction ---

type layoutField struct {
	Offset int
	Size   int
	Name   string
	Type   string
}

func parseLayout(raw []any) []layoutField {
	var fields []layoutField
	for _, item := range raw {
		m, ok := item.(map[string]any)
		if !ok {
			continue
		}
		f := layoutField{
			Offset: int(toFloat64(m["offset"])),
			Name:   getMapString(m, "name"),
			Type:   getMapString(m, "type"),
		}
		if s, ok := m["size"]; ok {
			f.Size = int(toFloat64(s))
		} else {
			f.Size = typeSizeDefault(f.Type)
		}
		fields = append(fields, f)
	}
	return fields
}

func typeSizeDefault(t string) int {
	switch t {
	case "uint8":
		return 1
	case "uint16_le", "uint16_be":
		return 2
	case "uint32_le", "int32_le", "float32_le":
		return 4
	case "float64_le":
		return 8
	default:
		return 1
	}
}

func decodeLayoutEntry(data []byte, layout []layoutField) map[string]any {
	result := make(map[string]any)
	for _, f := range layout {
		if f.Offset+f.Size > len(data) {
			continue
		}
		slice := data[f.Offset : f.Offset+f.Size]
		result[f.Name] = readBinaryValue(slice, f.Type)
	}
	return result
}

func readBinaryValue(data []byte, typ string) any {
	switch typ {
	case "uint8":
		return float64(data[0])
	case "uint16_le":
		return float64(binary.LittleEndian.Uint16(data))
	case "uint16_be":
		return float64(binary.BigEndian.Uint16(data))
	case "uint32_le":
		return float64(binary.LittleEndian.Uint32(data))
	case "int32_le":
		return float64(int32(binary.LittleEndian.Uint32(data)))
	case "float32_le":
		return float64(math.Float32frombits(binary.LittleEndian.Uint32(data)))
	case "float64_le":
		return math.Float64frombits(binary.LittleEndian.Uint64(data))
	default:
		return float64(data[0])
	}
}

// --- Transform evaluator ---
// Supports: "value / N", "value * N", "value + N", "value - N"

func applyTransform(value float64, expr string) float64 {
	expr = strings.TrimSpace(expr)
	if !strings.HasPrefix(expr, "value") {
		return value
	}
	rest := strings.TrimSpace(expr[5:])
	if len(rest) < 2 {
		return value
	}
	op := rest[0]
	numStr := strings.TrimSpace(rest[1:])
	num, err := strconv.ParseFloat(numStr, 64)
	if err != nil {
		return value
	}
	switch op {
	case '/':
		if num != 0 {
			return value / num
		}
	case '*':
		return value * num
	case '+':
		return value + num
	case '-':
		return value - num
	}
	return value
}

// --- Config helpers ---

func getConfigString(config map[string]any, key, def string) string {
	if v, ok := config[key].(string); ok && v != "" {
		return v
	}
	return def
}

func getConfigInt(config map[string]any, key string, def int) int {
	return int(toFloat64WithDefault(config[key], float64(def)))
}

func getMapString(m map[string]any, key string) string {
	if v, ok := m[key].(string); ok {
		return v
	}
	return ""
}

func toFloat64(v any) float64 {
	switch n := v.(type) {
	case float64:
		return n
	case int:
		return float64(n)
	case int64:
		return float64(n)
	case int32:
		return float64(n)
	}
	return 0
}

func toFloat64WithDefault(v any, def float64) float64 {
	if v == nil {
		return def
	}
	switch n := v.(type) {
	case float64:
		return n
	case int:
		return float64(n)
	case int64:
		return float64(n)
	}
	return def
}
