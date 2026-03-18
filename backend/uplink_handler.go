package main

import (
	"encoding/hex"
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

	// Load device's profile for decode dispatch
	profile, err := loadProfileForDevice(app, devEui)
	if err != nil {
		// No profile assigned — store as raw hex
		log.Printf("[uplink] no profile for %s, storing raw (fPort=%d)", devEui, fPort)
		return insertTelemetry(app, devEui, map[string]any{"raw": hex.EncodeToString(rawPayload)}, rssi, snr)
	}

	// Look up decode rule for this fPort
	rule := getDecodeRuleForFPort(profile, int(fPort))
	if rule == nil {
		// No decode rule — store raw
		return insertTelemetry(app, devEui, map[string]any{"raw": hex.EncodeToString(rawPayload)}, rssi, snr)
	}

	// Decode payload using JSON decode engine
	result, err := DecodeWithRules(rule.Format, rule.Config, profile.Fields, rawPayload)
	if err != nil {
		log.Printf("[uplink] decode error dev_eui=%s fPort=%d: %v", devEui, fPort, err)
		return insertTelemetry(app, devEui, map[string]any{"raw": hex.EncodeToString(rawPayload), "decode_error": err.Error()}, rssi, snr)
	}

	// Post-decode routing based on fPort
	switch fPort {
	case 3:
		// State changes — resolve control/state names from profile
		handleStateChanges(app, devEui, deviceName, profile, result)
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
func handleStateChanges(app core.App, devEui, deviceName string, profile *ProfileWithComponents, result *DecodeResult) {
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

		// Resolve control key and state names from profile
		ctrl := getControlByIndex(profile, ctrlIdx)
		controlKey := fmt.Sprintf("control_%d", ctrlIdx)
		if ctrl != nil {
			controlKey = ctrl.Key
		}
		newS := resolveStateNameFromProfile(ctrl, newStateIdx)
		oldS := resolveStateNameFromProfile(ctrl, oldStateIdx)

		var deviceTs time.Time
		if deviceMs > 0 {
			deviceTs = time.Unix(0, int64(deviceMs)*int64(time.Millisecond))
		}

		_ = insertStateChange(app, devEui, controlKey, oldS, newS, source, deviceTs)
		_ = upsertDeviceControl(app, devEui, controlKey, newS, source)

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
