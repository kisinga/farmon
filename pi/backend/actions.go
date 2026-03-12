package main

import (
	"encoding/json"
	"fmt"

	"github.com/kisinga/farmon/pi/internal/gateway"
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
	if cfg == nil || !cfg.Valid() {
		return fmt.Errorf("gateway not configured")
	}
	timeoutSec := uint32(0)
	if params.Duration > 0 {
		timeoutSec = uint32(params.Duration)
	}
	payload := BuildDirectControlPayload(
		lookupControlIndex(app, params.DeviceEUI, params.Control),
		stateToIndex(app, params.DeviceEUI, params.Control, params.State),
		timeoutSec,
	)
	cmdKey := "ctrl:" + params.Control + "=" + params.State
	if err := EnqueueDownlink(cfg, app, params.DeviceEUI, 20, payload); err != nil {
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

// Well-known command→fPort fallbacks (match firmware protocol_constants.h).
var wellKnownCmds = map[string]int{
	"reset": 10, "interval": 11, "reboot": 12, "clearerr": 13,
	"forcereg": 14, "status": 15, "displaytimeout": 16, "ctrl": 20,
}

// ExecuteSendCommand resolves fPort, encodes payload, enqueues downlink, and logs to commands.
func ExecuteSendCommand(app core.App, cfg *gateway.Config, params SendCommandParams) error {
	if cfg == nil || !cfg.Valid() {
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
		if p, ok := wellKnownCmds[params.Command]; ok {
			fPort = uint8(p)
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
	if err := EnqueueDownlink(cfg, app, params.DeviceEUI, fPort, payload); err != nil {
		cmdPayload["error"] = err.Error()
		insertCommand(app, params.DeviceEUI, params.Command, params.InitiatedBy, "error", cmdPayload)
		return err
	}
	insertCommand(app, params.DeviceEUI, params.Command, params.InitiatedBy, "sent", cmdPayload)
	return nil
}
