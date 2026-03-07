package main

import (
	"net/http"

	"github.com/pocketbase/pocketbase/core"
)

// setControlHandler enqueues a downlink to set device control (e.g. pump on/off).
// Phase 2.3: call ChirpStack API to enqueue downlink. For now returns accepted.
func setControlHandler(app core.App) func(*core.RequestEvent) error {
	return func(e *core.RequestEvent) error {
		var body struct {
			Eui     string `json:"eui"`
			Control string `json:"control"`
			State   string `json:"state"`
			Duration *int  `json:"duration,omitempty"`
		}
		if err := e.BindBody(&body); err != nil {
			return e.String(http.StatusBadRequest, "invalid body")
		}
		if body.Eui == "" || body.Control == "" {
			return e.String(http.StatusBadRequest, "eui and control required")
		}
		// TODO: ChirpStack API client — enqueue downlink for fPort 20 (direct control)
		return e.JSON(http.StatusOK, map[string]any{"ok": true, "message": "queued (stub)"})
	}
}

// gatewayStatusHandler returns gateway online/offline status for the UI.
// Phase 2.4: call ChirpStack API to list gateways. For now returns empty list.
func gatewayStatusHandler(app core.App) func(*core.RequestEvent) error {
	return func(e *core.RequestEvent) error {
		// TODO: ChirpStack API — list gateways and their connection state
		return e.JSON(http.StatusOK, map[string]any{"gateways": []any{}})
	}
}
