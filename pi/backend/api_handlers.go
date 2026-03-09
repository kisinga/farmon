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
func setControlHandler(app core.App, state *GatewayState) func(*core.RequestEvent) error {
	return func(e *core.RequestEvent) error {
		cfg := state.Config()
		if cfg == nil {
			return e.JSON(http.StatusServiceUnavailable, map[string]any{"ok": false, "error": "gateway not configured"})
		}
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

// gatewayStatusHandler returns gateway status for the UI. Online is derived from runtime (last event from concentratord within threshold).
// Includes discovered_gateway_id (in-memory gateway_id) so the settings page can prefill when not yet saved to DB.
func gatewayStatusHandler(state *GatewayState) func(*core.RequestEvent) error {
	return func(e *core.RequestEvent) error {
		cfg := state.Config()
		runtime := state.Runtime()
		online := false
		var lastSeen interface{}
		gwID := ""
		discoveredID := ""
		if cfg != nil {
			gwID = cfg.GatewayID
			discoveredID = cfg.GatewayID
			if gwID == "" && cfg.Valid() {
				gwID = "local"
			}
		}
		if runtime != nil {
			online = runtime.IsOnline()
			lastEventAt, runtimeGwID, _ := runtime.Get()
			if runtimeGwID != "" {
				gwID = runtimeGwID
				discoveredID = runtimeGwID
			}
			if !lastEventAt.IsZero() {
				lastSeen = lastEventAt.Format("2006-01-02T15:04:05.000Z07:00")
			}
		}
		resp := map[string]any{"gateways": []any{}}
		if gwID != "" || online {
			resp["gateways"] = []any{map[string]any{"id": gwID, "name": gwID, "online": online, "lastSeen": lastSeen}}
		}
		if discoveredID != "" {
			resp["discovered_gateway_id"] = discoveredID
		}
		return e.JSON(http.StatusOK, resp)
	}
}

// pipelineDebugHandler returns concentratord config and runtime state (for debugging "no gateway online").
// GET /api/farmon/debug/pipeline — no auth required for local diagnostics.
// Config is loaded from DB so the UI shows saved settings even if pipeline/restart failed; when DB has valid config but in-memory did not, we sync and restart the pipeline.
func pipelineDebugHandler(app core.App, state *GatewayState) func(*core.RequestEvent) error {
	return func(e *core.RequestEvent) error {
		cfg, valid := loadGatewaySettings(app)
		runtime := state.Runtime()
		resp := map[string]any{
			"concentratord_configured": false,
			"gateway_id_set":          false,
			"gateway_id":              cfg.GatewayID,
			"event_url":               cfg.EventURL,
			"command_url":             cfg.CommandURL,
			"rx1_delay_sec":           cfg.RX1DelaySec,
			"online":                  false,
			"last_event_at":           nil,
			"sub_connected":           false,
		}
		resp["concentratord_configured"] = valid
		resp["gateway_id_set"] = cfg.GatewayID != ""
		if runtime != nil {
			resp["online"] = runtime.IsOnline()
			lastEventAt, gatewayID, subConnected := runtime.Get()
			if !lastEventAt.IsZero() {
				resp["last_event_at"] = lastEventAt.Format("2006-01-02T15:04:05.000Z07:00")
			}
			resp["sub_connected"] = subConnected
			if gatewayID != "" {
				resp["gateway_id"] = gatewayID
				resp["gateway_id_set"] = true
			}
		}
		// If DB has valid config but in-memory state was not configured, sync and start pipeline (e.g. pipeline/restart failed after save).
		if valid {
			inMem := state.Config()
			if inMem == nil || !inMem.Valid() {
				state.SetConfig(cfg)
				state.RestartPipeline(app)
			}
		}
		return e.JSON(http.StatusOK, resp)
	}
}

// lorawanFramesHandler returns recent raw LoRaWAN frames (uplinks + downlinks) for the monitor UI.
// GET /api/farmon/lorawan/frames?limit=100
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
// GET /api/farmon/lorawan/stats
func lorawanStatsHandler(state *GatewayState) func(*core.RequestEvent) error {
	return func(e *core.RequestEvent) error {
		cfg := state.Config()
		stats := GetFrameStats()
		configured := false
		if cfg != nil {
			configured = cfg.Valid()
		}
		return e.JSON(http.StatusOK, map[string]any{
			"buffer_size":             stats.BufferSize,
			"total_uplinks":           stats.TotalUplinks,
			"total_downlinks":         stats.TotalDownlinks,
			"concentratord_configured": configured,
		})
	}
}

// lorawanClearFramesHandler clears the in-memory frame buffer. POST /api/farmon/lorawan/frames/clear
func lorawanClearFramesHandler() func(*core.RequestEvent) error {
	return func(e *core.RequestEvent) error {
		ClearFrames()
		return e.JSON(http.StatusOK, map[string]any{"ok": true})
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
