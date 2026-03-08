package main

import (
	"net/http"
	"strconv"
	"strings"

	"github.com/pocketbase/pocketbase/core"

	"github.com/kisinga/farmon/pi/internal/gateway"
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

// BuildDirectControlPayload returns 7 bytes for fPort 20: [control_idx, state_idx, is_manual, timeout_sec LE].
func BuildDirectControlPayload(controlIdx, stateIdx int, timeoutSec uint32) []byte {
	return []byte{
		byte(controlIdx),
		byte(stateIdx),
		1, // is_manual
		byte(timeoutSec),
		byte(timeoutSec >> 8),
		byte(timeoutSec >> 16),
		byte(timeoutSec >> 24),
	}
}

// setControlHandler enqueues a downlink to set device control (e.g. pump on/off).
func setControlHandler(app core.App, cfg *gateway.Config) func(*core.RequestEvent) error {
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
		if err := EnqueueDownlink(cfg, app, body.Eui, 20, payload); err != nil {
			return e.JSON(http.StatusInternalServerError, map[string]any{"ok": false, "error": err.Error()})
		}
		return e.JSON(http.StatusOK, map[string]any{"ok": true, "message": "queued"})
	}
}

// gatewayStatusHandler returns gateway status for the UI. When gateway settings are valid, one gateway is reported online.
func gatewayStatusHandler(cfg *gateway.Config) func(*core.RequestEvent) error {
	return func(e *core.RequestEvent) error {
		gwID := cfg.GatewayID
		if gwID == "" && cfg.Valid() {
			gwID = "local"
		}
		if gwID != "" {
			return e.JSON(http.StatusOK, map[string]any{
				"gateways": []any{map[string]any{"id": gwID, "name": gwID, "online": true, "lastSeen": nil}},
			})
		}
		return e.JSON(http.StatusOK, map[string]any{"gateways": []any{}})
	}
}

// pipelineDebugHandler returns whether concentratord is configured (for debugging "no gateway online").
// GET /api/debug/pipeline — no auth required for local diagnostics.
func pipelineDebugHandler(cfg *gateway.Config) func(*core.RequestEvent) error {
	return func(e *core.RequestEvent) error {
		return e.JSON(http.StatusOK, map[string]any{
			"concentratord_configured": cfg.Valid(),
			"gateway_id_set":          cfg.GatewayID != "",
			"gateway_id":              cfg.GatewayID,
			"event_url":               cfg.EventURL,
			"command_url":             cfg.CommandURL,
			"rx1_delay_sec":           cfg.RX1DelaySec,
		})
	}
}

// lorawanFramesHandler returns recent raw LoRaWAN frames (uplinks + downlinks) for the monitor UI.
// GET /api/lorawan/frames?limit=100
func lorawanFramesHandler() func(*core.RequestEvent) error {
	return func(e *core.RequestEvent) error {
		limit := 100
		if s := e.Request.URL.Query().Get("limit"); s != "" {
			if n, err := strconv.Atoi(s); err == nil && n > 0 && n <= 500 {
				limit = n
			}
		}
		frames := GetFrames(limit)
		return e.JSON(http.StatusOK, map[string]any{"frames": frames})
	}
}

// lorawanStatsHandler returns frame buffer stats and pipeline status.
// GET /api/lorawan/stats
func lorawanStatsHandler(cfg *gateway.Config) func(*core.RequestEvent) error {
	return func(e *core.RequestEvent) error {
		stats := GetFrameStats()
		return e.JSON(http.StatusOK, map[string]any{
			"buffer_size":             stats.BufferSize,
			"total_uplinks":           stats.TotalUplinks,
			"total_downlinks":         stats.TotalDownlinks,
			"concentratord_configured": cfg.Valid(),
		})
	}
}

// lorawanClearFramesHandler clears the in-memory frame buffer. POST /api/lorawan/frames/clear
func lorawanClearFramesHandler() func(*core.RequestEvent) error {
	return func(e *core.RequestEvent) error {
		ClearFrames()
		return e.JSON(http.StatusOK, map[string]any{"ok": true})
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

// otaStartHandler accepts OTA start request (eui, optional firmware). Progress stored via uplink fPort 8.
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
		// TODO: enqueue OTA start downlink when device protocol supports it
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
		// TODO: enqueue OTA cancel downlink when device protocol supports it
		return e.JSON(http.StatusOK, map[string]any{"ok": true, "message": "OTA cancel requested"})
	}
}
