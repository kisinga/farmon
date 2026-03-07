package codec

import (
	"encoding/binary"
	"strconv"
	"strings"
)

// DecodeUplink decodes a raw payload by fPort and returns the "data" object for the pipeline.
// Matches the former JS codec: decodeUplink({ fPort, bytes }).data
func DecodeUplink(fPort uint8, payload []byte) map[string]any {
	if payload == nil {
		return nil
	}
	text := string(payload)
	switch fPort {
	case 1:
		return decodeRegistration(text)
	case 2:
		return decodeTelemetry(text)
	case 3:
		return decodeStateChange(payload)
	case 4:
		return decodeCommandAck(text)
	case 6:
		return decodeDiagnostics(text)
	case 8:
		return decodeOTAProgress(payload)
	default:
		return map[string]any{"raw": text}
	}
}

// decodeRegistration: fPort 1 — reg:frameKey|data or error
func decodeRegistration(text string) map[string]any {
	if text == "" {
		return map[string]any{"error": "Invalid input: text is required"}
	}
	if !strings.HasPrefix(text, "reg:") {
		return map[string]any{"error": "Multi-frame registration required", "raw": text}
	}
	pipe := strings.Index(text, "|")
	if pipe < 0 {
		return map[string]any{"error": "Invalid frame format: missing pipe separator", "raw": text}
	}
	frameKey := strings.TrimSpace(text[4:pipe])
	frameData := ""
	if pipe+1 < len(text) {
		frameData = text[pipe+1:]
	}
	validKeys := map[string]bool{"header": true, "fields": true, "sys": true, "states": true, "cmds": true}
	if !validKeys[frameKey] {
		return map[string]any{"error": "Invalid frame key: " + frameKey, "frameKey": frameKey, "frameData": frameData}
	}
	return map[string]any{"isFrame": true, "frameKey": frameKey, "frameData": frameData}
}

// decodeTelemetry: fPort 2 — key:value,key:value; values as float or string
func decodeTelemetry(text string) map[string]any {
	out := make(map[string]any)
	for _, pair := range strings.Split(text, ",") {
		colon := strings.Index(pair, ":")
		if colon < 0 {
			continue
		}
		key := pair[:colon]
		value := strings.TrimSpace(pair[colon+1:])
		if num, err := strconv.ParseFloat(value, 64); err == nil {
			out[key] = num
		} else {
			out[key] = value
		}
	}
	return out
}

// decodeStateChange: fPort 3 — 11 bytes per record: control_idx, new_state, old_state, source_id, rule_id, device_ms LE, seq LE
var stateChangeSources = []string{"BOOT", "RULE", "MANUAL", "DOWNLINK"}

func decodeStateChange(bytes []byte) map[string]any {
	if len(bytes) < 11 {
		return map[string]any{"error": "Invalid state change length: " + strconv.Itoa(len(bytes))}
	}
	if len(bytes)%11 != 0 {
		return map[string]any{"error": "Invalid state change batch length (must be multiple of 11)"}
	}
	var stateChanges []map[string]any
	for i := 0; i+11 <= len(bytes); i += 11 {
		srcID := int(bytes[i+3])
		source := "UNKNOWN"
		if srcID >= 0 && srcID < len(stateChangeSources) {
			source = stateChangeSources[srcID]
		}
		deviceMs := binary.LittleEndian.Uint32(bytes[i+5 : i+9])
		seq := binary.LittleEndian.Uint16(bytes[i+9 : i+11])
		stateChanges = append(stateChanges, map[string]any{
			"control_idx": float64(bytes[i]),
			"new_state":   float64(bytes[i+1]),
			"old_state":   float64(bytes[i+2]),
			"source":      source,
			"source_id":   float64(srcID),
			"rule_id":     float64(bytes[i+4]),
			"device_ms":   float64(deviceMs),
			"seq":         float64(seq),
		})
	}
	return map[string]any{"stateChanges": stateChanges}
}

// decodeCommandAck: fPort 4 — "port:status"
func decodeCommandAck(text string) map[string]any {
	parts := strings.SplitN(text, ":", 2)
	port := 0
	if len(parts) > 0 {
		port, _ = strconv.Atoi(strings.TrimSpace(parts[0]))
	}
	status := "unknown"
	if len(parts) > 1 {
		status = strings.TrimSpace(parts[1])
	}
	return map[string]any{"port": float64(port), "status": status, "success": status == "ok"}
}

// decodeDiagnostics: fPort 6 — key:value like telemetry; "fw" stays string
func decodeDiagnostics(text string) map[string]any {
	out := make(map[string]any)
	for _, pair := range strings.Split(text, ",") {
		colon := strings.Index(pair, ":")
		if colon < 0 {
			continue
		}
		key := strings.TrimSpace(pair[:colon])
		value := strings.TrimSpace(pair[colon+1:])
		if key == "fw" {
			out[key] = value
		} else if num, err := strconv.ParseFloat(value, 64); err == nil {
			out[key] = num
		} else {
			out[key] = value
		}
	}
	return out
}

// decodeOTAProgress: fPort 8 — 3 bytes: status, chunkIndex LE
func decodeOTAProgress(bytes []byte) map[string]any {
	if len(bytes) < 3 {
		return map[string]any{"error": "OTA progress payload too short", "raw": bytes}
	}
	chunkIndex := uint16(bytes[1]) | uint16(bytes[2])<<8
	return map[string]any{"status": float64(bytes[0]), "chunkIndex": float64(chunkIndex)}
}
