package main

import (
	"net/http"
	"strconv"
	"strings"

	"github.com/pocketbase/pocketbase/core"
)

// controlNameToIndex maps control key to codec control_idx (fPort 20).
func controlNameToIndex(control string) int {
	switch strings.ToLower(strings.TrimSpace(control)) {
	case "pump":
		return 0
	case "valve":
		return 1
	default:
		return 0
	}
}

// stateToIndex maps state string to codec state_idx (0=off, 1=on).
func stateToIndex(state string) int {
	switch strings.ToLower(strings.TrimSpace(state)) {
	case "on", "open", "1", "true":
		return 1
	default:
		return 0
	}
}

// setControlHandler enqueues a downlink to set device control (e.g. pump on/off).
func setControlHandler(app core.App) func(*core.RequestEvent) error {
	client := NewChirpStackClient()
	return func(e *core.RequestEvent) error {
		var body struct {
			Eui      string `json:"eui"`
			Control  string `json:"control"`
			State    string `json:"state"`
			Duration *int   `json:"duration,omitempty"`
		}
		if err := e.BindBody(&body); err != nil {
			return e.String(http.StatusBadRequest, "invalid body")
		}
		if body.Eui == "" || body.Control == "" {
			return e.String(http.StatusBadRequest, "eui and control required")
		}
		timeoutSec := uint32(0)
		if body.Duration != nil && *body.Duration > 0 {
			timeoutSec = uint32(*body.Duration)
		}
		payload := BuildDirectControlPayload(
			controlNameToIndex(body.Control),
			stateToIndex(body.State),
			timeoutSec,
		)
		if err := client.EnqueueDownlink(body.Eui, payload); err != nil {
			return e.JSON(http.StatusInternalServerError, map[string]any{"ok": false, "error": err.Error()})
		}
		return e.JSON(http.StatusOK, map[string]any{"ok": true, "message": "queued"})
	}
}

// gatewayStatusHandler returns gateway online/offline status for the UI.
func gatewayStatusHandler(app core.App) func(*core.RequestEvent) error {
	client := NewChirpStackClient()
	return func(e *core.RequestEvent) error {
		list, err := client.ListGateways()
		if err != nil {
			return e.JSON(http.StatusOK, map[string]any{"gateways": []any{}})
		}
		out := make([]any, 0, len(list))
		for _, g := range list {
			out = append(out, map[string]any{
				"id":       g.ID,
				"name":     g.Name,
				"online":   g.Online,
				"lastSeen": g.LastSeen,
			})
		}
		return e.JSON(http.StatusOK, map[string]any{"gateways": out})
	}
}

// historyHandler returns telemetry history for a device field: GET /api/history?eui=...&field=...&from=...&to=...&limit=500
func historyHandler(app core.App) func(*core.RequestEvent) error {
	return func(e *core.RequestEvent) error {
		eui := e.Request.URL.Query().Get("eui")
		field := e.Request.URL.Query().Get("field")
		if eui == "" || field == "" {
			return e.String(http.StatusBadRequest, "eui and field required")
		}
		from := e.Request.URL.Query().Get("from")
		to := e.Request.URL.Query().Get("to")
		limit := 500
		if l := e.Request.URL.Query().Get("limit"); l != "" {
			if n, err := strconv.Atoi(l); err == nil && n > 0 {
				limit = n
			}
		}
		data, err := GetTelemetryHistory(app, eui, field, from, to, limit)
		if err != nil {
			return e.JSON(http.StatusInternalServerError, map[string]any{"error": err.Error()})
		}
		return e.JSON(http.StatusOK, map[string]any{
			"eui":   eui,
			"field": field,
			"data":  data,
		})
	}
}

// otaStartHandler accepts OTA start request (eui, optional firmware). Progress is stored via ChirpStack webhook fPort 8.
func otaStartHandler(app core.App) func(*core.RequestEvent) error {
	return func(e *core.RequestEvent) error {
		var body struct {
			Eui      string `json:"eui"`
			Firmware string `json:"firmware,omitempty"`
		}
		if err := e.BindBody(&body); err != nil {
			return e.String(http.StatusBadRequest, "invalid body")
		}
		if body.Eui == "" {
			return e.String(http.StatusBadRequest, "eui required")
		}
		// TODO: enqueue OTA start command via ChirpStack if device protocol defines it
		return e.JSON(http.StatusOK, map[string]any{"ok": true, "message": "OTA start requested"})
	}
}

// otaCancelHandler accepts OTA cancel request (eui).
func otaCancelHandler(app core.App) func(*core.RequestEvent) error {
	return func(e *core.RequestEvent) error {
		var body struct {
			Eui string `json:"eui"`
		}
		if err := e.BindBody(&body); err != nil {
			return e.String(http.StatusBadRequest, "invalid body")
		}
		if body.Eui == "" {
			return e.String(http.StatusBadRequest, "eui required")
		}
		// TODO: enqueue OTA cancel command via ChirpStack if device protocol defines it
		return e.JSON(http.StatusOK, map[string]any{"ok": true, "message": "OTA cancel requested"})
	}
}
