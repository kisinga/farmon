package main

import (
	"encoding/hex"
	"encoding/json"
	"fmt"
	"log"
	"strconv"
	"time"

	"github.com/kisinga/farmon/internal/gateway"
	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/core"
)

// handleUplinkFromPipeline persists decoded uplink using profile-based decode dispatch.
// rawPayload is the undecoded FRMPayload bytes from the LoRaWAN frame.
func handleUplinkFromPipeline(app core.App, devEui, deviceName string, fPort uint8, rawPayload []byte, rssi *int, snr *float64, cfg *gateway.Config) error {
	if deviceName == "" {
		deviceName = devEui
	}
	if err := upsertDevice(app, devEui, deviceName); err != nil {
		return err
	}

	// fPort 1: device checkin (always binary, no decode rule needed)
	if fPort == 1 {
		return handleDeviceCheckin(app, cfg, devEui, rawPayload)
	}

	// Load device-level config for decode dispatch
	deviceCfg, err := loadDeviceConfig(app, devEui)
	if err != nil {
		// No device config — store as raw hex
		log.Printf("[uplink] no device config for %s, storing raw (fPort=%d)", devEui, fPort)
		return insertTelemetry(app, devEui, map[string]any{"raw": hex.EncodeToString(rawPayload)}, rssi, snr)
	}

	// Look up decode rule from device-level rules; airconfig devices get synthetic fallbacks
	rule := getDeviceDecodeRuleForFPort(deviceCfg, int(fPort))
	if rule == nil && deviceCfg.DeviceType == "airconfig" {
		rule = airconfigSyntheticRule(int(fPort))
	}
	if rule == nil {
		// No decode rule — store raw
		return insertTelemetry(app, devEui, map[string]any{"raw": hex.EncodeToString(rawPayload)}, rssi, snr)
	}

	// Decode payload using device-level field mappings
	result, err := DecodeWithRules(rule.Format, rule.Config, deviceCfg.Fields, rawPayload)
	if err != nil {
		log.Printf("[uplink] decode error dev_eui=%s fPort=%d: %v", devEui, fPort, err)
		return insertTelemetry(app, devEui, map[string]any{"raw": hex.EncodeToString(rawPayload), "decode_error": err.Error()}, rssi, snr)
	}

	// Patch the most recent frame record with decoded payload for the network monitor
	if result.Fields != nil {
		if djBytes, err := json.Marshal(result.Fields); err == nil {
			PatchFrameDecoded(app, devEui, string(djBytes))
		}
	}

	// Post-decode routing based on fPort
	switch fPort {
	case 3:
		// State changes — resolve control/state names from device config
		handleStateChanges(app, devEui, deviceName, deviceCfg, result)
	case 4:
		// Command ACK
		handleCommandAck(app, devEui, result)
	default:
		// Telemetry (fPort 2 and any other decoded fPort)
		if err := insertTelemetry(app, devEui, result.Fields, rssi, snr); err != nil {
			return err
		}
		if workflowEngine != nil {
			go workflowEngine.Evaluate(TriggerContext{Type: TriggerTelemetry, DeviceEUI: devEui, DeviceName: deviceName, Telemetry: result.Fields})
		}
	}

	return nil
}

// handleStateChanges processes decoded state change records.
func handleStateChanges(app core.App, devEui, deviceName string, deviceCfg *DeviceConfig, result *DecodeResult) {
	sc, ok := result.Fields["stateChanges"].([]any)
	if !ok {
		return
	}
	for _, v := range sc {
		m, _ := v.(map[string]any)
		if m == nil {
			continue
		}
		ctrlIdx := int(toFloat64(m["control_idx"]))
		newStateIdx := int(toFloat64(m["new_state"]))
		oldStateIdx := int(toFloat64(m["old_state"]))
		source, _ := m["source"].(string)
		deviceMs := toFloat64(m["device_ms"])

		// Resolve control key and state names from device config
		ctrl := getDeviceControlByIndex(deviceCfg, ctrlIdx)
		controlKey := fmt.Sprintf("control_%d", ctrlIdx)
		if ctrl != nil {
			controlKey = ctrl.ControlKey
		}
		newS := resolveStateNameFromDevice(ctrl, newStateIdx)
		oldS := resolveStateNameFromDevice(ctrl, oldStateIdx)

		var deviceTs time.Time
		if deviceMs > 0 {
			deviceTs = time.Unix(0, int64(deviceMs)*int64(time.Millisecond))
		}

		_ = insertStateChange(app, devEui, controlKey, oldS, newS, source, deviceTs)
		_ = upsertDeviceControl(app, devEui, controlKey, float64(newStateIdx), source)

		if workflowEngine != nil {
			go workflowEngine.Evaluate(TriggerContext{
				Type: TriggerStateChange, DeviceEUI: devEui, DeviceName: deviceName,
				ControlKey: controlKey, OldState: oldS, NewState: newS, Source: source,
			})
		}
	}
}

// handleCommandAck processes decoded command ACK.
// Updates the most recent "sent" command record for this device to "acked" or "ack_error".
func handleCommandAck(app core.App, devEui string, result *DecodeResult) {
	port := toFloat64(result.Fields["port"])
	ackStatus, _ := result.Fields["status"].(string)
	success, _ := result.Fields["success"].(bool)
	status := "acked"
	if !success {
		status = "ack_error"
	}

	// Find the most recent "sent" command for this device and update it.
	recs, err := app.FindRecordsByFilter("commands",
		"device_eui = {:eui} && status = 'sent'",
		"-sent_at", 1, 0,
		dbx.Params{"eui": devEui})
	if err == nil && len(recs) > 0 {
		recs[0].Set("status", status)
		_ = app.Save(recs[0])
		return
	}

	// No matching sent command — insert a standalone ack record for visibility.
	insertCommand(app, devEui, "ack:fPort"+strconv.Itoa(int(port)), "device", status, map[string]any{"port": port, "status": ackStatus})
}

// airconfigSyntheticRule returns a hardcoded decode rule for well-known airconfig fPorts.
// All airconfig devices run the same firmware, so their binary formats are fixed.
// fPort 2: compact telemetry (binary_indexed_float32, self-describing)
// fPort 3: state change records (binary_state_change, 11-byte records)
// fPort 4: command ACK (text_kv)
func airconfigSyntheticRule(fPort int) *DecodeRule {
	switch fPort {
	case 2:
		return &DecodeRule{FPort: 2, Format: "binary_indexed_float32", Config: map[string]any{}}
	case 3:
		return &DecodeRule{FPort: 3, Format: "binary_state_change", Config: map[string]any{
			"record_size": 11,
			"layout": []map[string]any{
				{"offset": 0, "name": "control_idx", "type": "uint8"},
				{"offset": 1, "name": "new_state", "type": "uint8"},
				{"offset": 2, "name": "old_state", "type": "uint8"},
				{"offset": 3, "name": "source_id", "type": "uint8"},
				{"offset": 4, "name": "rule_id", "type": "uint8"},
				{"offset": 5, "name": "device_ms", "type": "uint32_le"},
				{"offset": 9, "name": "seq", "type": "uint16_le"},
			},
			"source_map": map[string]string{"0": "BOOT", "1": "RULE", "2": "MANUAL", "3": "DOWNLINK"},
		}}
	case 4:
		return &DecodeRule{FPort: 4, Format: "text_kv", Config: map[string]any{
			"separator": ":", "kv_separator": ":",
		}}
	}
	return nil
}

// getFloat64 extracts a float64 from an interface{} (kept for backward compat with actions.go/workflow_engine.go).
func getFloat64(v interface{}) float64 {
	return toFloat64(v)
}

// normalizeEui strips non-hex characters and lowercases.
func normalizeEui(eui string) string {
	out := make([]byte, 0, 16)
	for _, c := range eui {
		if (c >= '0' && c <= '9') || (c >= 'a' && c <= 'f') {
			out = append(out, byte(c))
		} else if c >= 'A' && c <= 'F' {
			out = append(out, byte(c-'A'+'a'))
		}
	}
	if len(out) > 16 {
		out = out[:16]
	}
	return string(out)
}
