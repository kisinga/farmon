package main

import (
	"encoding/json"
	"fmt"
	"strconv"
	"time"

	"github.com/kisinga/farmon/firmware/pkg/protocol"
	"github.com/kisinga/farmon/internal/gateway"
	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/core"
)

// SetControlParams encapsulates a control action.
type SetControlParams struct {
	DeviceEUI   string
	Control     string
	State       string
	Duration    int    // seconds, 0 = no timeout
	InitiatedBy string // "api" | "automation"
}

// ExecuteSetControl resolves indices, builds fPort 20 payload, enqueues downlink, and logs to commands.
func ExecuteSetControl(app core.App, cfg *gateway.Config, params SetControlParams) error {
	if cfg == nil {
		return fmt.Errorf("gateway not configured")
	}
	timeoutSec := uint32(0)
	if params.Duration > 0 {
		timeoutSec = uint32(params.Duration)
	}
	cmdKey := "ctrl:" + params.Control + "=" + params.State

	// WiFi devices get structured JSON commands instead of binary fPort payloads
	if lookupDeviceTransport(app, params.DeviceEUI) == "wifi" {
		jsonCmd := map[string]any{
			"command":  "set_control",
			"control":  params.Control,
			"state":    params.State,
			"duration": timeoutSec,
		}
		if err := enqueueWiFiCommand(app, params.DeviceEUI, 20, nil, jsonCmd); err != nil {
			insertCommand(app, params.DeviceEUI, cmdKey, params.InitiatedBy, "error", map[string]any{"control": params.Control, "state": params.State, "error": err.Error()})
			return err
		}
		insertCommand(app, params.DeviceEUI, cmdKey, params.InitiatedBy, "sent", map[string]any{"control": params.Control, "state": params.State, "duration": timeoutSec})
		return nil
	}

	payload := BuildDirectControlPayload(
		lookupControlIndex(app, params.DeviceEUI, params.Control),
		stateToIndex(app, params.DeviceEUI, params.Control, params.State),
		timeoutSec,
	)
	if err := EnqueueDownlinkForDevice(app, cfg, params.DeviceEUI, 20, payload); err != nil {
		insertCommand(app, params.DeviceEUI, cmdKey, params.InitiatedBy, "error", map[string]any{"control": params.Control, "state": params.State, "error": err.Error()})
		return err
	}
	insertCommand(app, params.DeviceEUI, cmdKey, params.InitiatedBy, "sent", map[string]any{"control": params.Control, "state": params.State, "duration": timeoutSec})
	return nil
}

// SendCommandParams encapsulates a generic command action.
type SendCommandParams struct {
	DeviceEUI   string
	Command     string
	Value       *uint32
	InitiatedBy string
}

// fPortForCommand resolves a command key to its fPort using the firmware's
// authoritative protocol.Commands definition. Falls back to device-level
// commands_json overrides for codec devices with custom fPort mappings.
func fPortForCommand(key string) (uint8, bool) {
	for _, cmd := range protocol.Commands {
		if cmd.Key == key {
			return uint8(cmd.FPort), true
		}
	}
	return 0, false
}

// ExecuteSendCommand resolves fPort, encodes payload, enqueues downlink, and logs to commands.
func ExecuteSendCommand(app core.App, cfg *gateway.Config, params SendCommandParams) error {
	if cfg == nil {
		return fmt.Errorf("gateway not configured")
	}

	// Look up fPort from device's commands_json, fall back to well-known
	var fPort uint8
	devRec, err := app.FindFirstRecordByFilter("devices",
		"device_eui = {:eui}", dbx.Params{"eui": params.DeviceEUI})
	if err != nil {
		return fmt.Errorf("device not found: %s", params.DeviceEUI)
	}
	cmdsRaw := devRec.Get("commands_json")
	var cmds map[string]any
	switch v := cmdsRaw.(type) {
	case string:
		_ = json.Unmarshal([]byte(v), &cmds)
	case map[string]any:
		cmds = v
	}
	if cmds != nil {
		if portVal, ok := cmds[params.Command]; ok {
			fPort = uint8(getFloat64(portVal))
		}
	}
	if fPort == 0 {
		if p, ok := fPortForCommand(params.Command); ok {
			fPort = p
		} else {
			return fmt.Errorf("unknown command: %s", params.Command)
		}
	}

	// Build payload based on command type
	var payload []byte
	if params.Value != nil {
		// For interval command (fPort 11): 4 bytes big-endian milliseconds
		ms := *params.Value * 1000
		payload = []byte{
			byte(ms >> 24), byte(ms >> 16), byte(ms >> 8), byte(ms),
		}
	}

	cmdPayload := map[string]any{"fPort": fPort}
	if params.Value != nil {
		cmdPayload["value"] = *params.Value
	}

	// WiFi devices get structured JSON commands
	if lookupDeviceTransport(app, params.DeviceEUI) == "wifi" {
		jsonCmd := map[string]any{
			"command": params.Command,
			"fport":   fPort,
		}
		if params.Value != nil {
			jsonCmd["value"] = *params.Value
		}
		if err := enqueueWiFiCommand(app, params.DeviceEUI, fPort, nil, jsonCmd); err != nil {
			cmdPayload["error"] = err.Error()
			insertCommand(app, params.DeviceEUI, params.Command, params.InitiatedBy, "error", cmdPayload)
			return err
		}
		insertCommand(app, params.DeviceEUI, params.Command, params.InitiatedBy, "sent", cmdPayload)
		return nil
	}

	if err := EnqueueDownlinkForDevice(app, cfg, params.DeviceEUI, fPort, payload); err != nil {
		cmdPayload["error"] = err.Error()
		insertCommand(app, params.DeviceEUI, params.Command, params.InitiatedBy, "error", cmdPayload)
		return err
	}
	insertCommand(app, params.DeviceEUI, params.Command, params.InitiatedBy, "sent", cmdPayload)
	return nil
}

// --- Global workflow variables ---

// getWorkflowVar returns the float64 value of a workflow_vars key, or 0 if not found / expired.
func getWorkflowVar(app core.App, key string) float64 {
	rec, err := app.FindFirstRecordByFilter("workflow_vars",
		"key = {:key}", dbx.Params{"key": key})
	if err != nil {
		return 0
	}
	expiresAt := rec.GetString("expires_at")
	if expiresAt != "" {
		t, err := time.Parse(time.RFC3339, expiresAt)
		if err == nil && time.Now().After(t) {
			return 0 // expired
		}
	}
	v, _ := strconv.ParseFloat(rec.GetString("value"), 64)
	return v
}

// executeSetVar creates or replaces a workflow_vars entry with the given string value and optional TTL.
func executeSetVar(app core.App, key, value string, expiresInSec int) error {
	if key == "" {
		return fmt.Errorf("set_var: key is required")
	}
	coll, err := app.FindCollectionByNameOrId("workflow_vars")
	if err != nil {
		return fmt.Errorf("workflow_vars collection not found: %w", err)
	}
	rec, err := app.FindFirstRecordByFilter("workflow_vars", "key = {:key}", dbx.Params{"key": key})
	if err != nil {
		rec = core.NewRecord(coll)
		rec.Set("key", key)
	}
	rec.Set("value", value)
	if expiresInSec > 0 {
		rec.Set("expires_at", time.Now().Add(time.Duration(expiresInSec)*time.Second).Format(time.RFC3339))
	} else {
		rec.Set("expires_at", "")
	}
	return app.Save(rec)
}

// executeIncrementVar increments a workflow_vars counter by amount.
// If the key does not exist or has expired, it is created with value = amount and the given TTL.
// TTL is only applied when creating a new entry; existing live entries keep their current expiry.
func executeIncrementVar(app core.App, key string, amount float64, expiresInSec int) error {
	if key == "" {
		return fmt.Errorf("increment_var: key is required")
	}
	coll, err := app.FindCollectionByNameOrId("workflow_vars")
	if err != nil {
		return fmt.Errorf("workflow_vars collection not found: %w", err)
	}
	rec, err := app.FindFirstRecordByFilter("workflow_vars", "key = {:key}", dbx.Params{"key": key})

	isNew := err != nil
	if !isNew {
		// Check expiry
		expiresAt := rec.GetString("expires_at")
		if expiresAt != "" {
			t, parseErr := time.Parse(time.RFC3339, expiresAt)
			if parseErr == nil && time.Now().After(t) {
				isNew = true // treat expired as new
			}
		}
	}

	if isNew {
		rec = core.NewRecord(coll)
		rec.Set("key", key)
		rec.Set("value", strconv.FormatFloat(amount, 'f', -1, 64))
		if expiresInSec > 0 {
			rec.Set("expires_at", time.Now().Add(time.Duration(expiresInSec)*time.Second).Format(time.RFC3339))
		}
	} else {
		current, _ := strconv.ParseFloat(rec.GetString("value"), 64)
		rec.Set("value", strconv.FormatFloat(current+amount, 'f', -1, 64))
	}
	return app.Save(rec)
}
