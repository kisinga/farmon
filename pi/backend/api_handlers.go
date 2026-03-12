package main

import (
	"encoding/json"
	"log"
	"net/http"
	"strconv"
	"strings"

	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/core"
)

// lookupControlIndex finds the control_idx for a given control_key from the DB.
// Falls back to legacy hardcoded mapping if no registration data exists.
func lookupControlIndex(app core.App, devEUI, control string) int {
	control = strings.ToLower(strings.TrimSpace(control))
	rec, err := app.FindFirstRecordByFilter("device_controls",
		"device_eui = {:eui} && control_key = {:key}",
		dbx.Params{"eui": devEUI, "key": control})
	if err == nil {
		if idx, ok := rec.Get("control_idx").(float64); ok {
			return int(idx)
		}
		if idx, ok := rec.Get("control_idx").(int); ok {
			return idx
		}
	}
	// Fallback for devices that haven't registered yet
	switch control {
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
			lookupControlIndex(app, body.Eui, body.Control),
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
		cfg, valid, configStatus := loadGatewaySettingsWithStatus(app)
		runtime := state.Runtime()
		resp := map[string]any{
			"concentratord_configured": false,
			"config_status":           configStatus,
			"gateway_id_set":          false,
			"gateway_id":              cfg.GatewayID,
			"event_url":               cfg.EventURL,
			"command_url":             cfg.CommandURL,
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

// gatewaySettingsEffectiveHandler returns the in-memory config the pipeline uses (for comparing DB vs runtime).
// GET /api/farmon/gateway-settings/effective
func gatewaySettingsEffectiveHandler(state *GatewayState) func(*core.RequestEvent) error {
	return func(e *core.RequestEvent) error {
		cfg := state.Config()
		if cfg == nil {
			return e.JSON(http.StatusOK, map[string]any{"configured": false, "event_url": "", "command_url": "", "region": "", "gateway_id": ""})
		}
		return e.JSON(http.StatusOK, map[string]any{
			"configured":   cfg.Valid(),
			"event_url":    cfg.EventURL,
			"command_url":  cfg.CommandURL,
			"region":       cfg.Region,
			"gateway_id":   cfg.GatewayID,
			"rx1_freq_hz":  cfg.RX1FrequencyHz,
		})
	}
}

// lorawanFramesHandler returns the most recent LoRaWAN frames from the DB for the monitor UI.
// GET /api/farmon/lorawan/frames?limit=200
func lorawanFramesHandler(app core.App) func(*core.RequestEvent) error {
	return func(e *core.RequestEvent) error {
		limit := 200
		if s := e.Request.URL.Query().Get("limit"); s != "" {
			if n, err := strconv.Atoi(s); err == nil && n > 0 && n <= 500 {
				limit = n
			}
		}
		if _, err := app.FindCollectionByNameOrId(lorawanFramesCollectionName); err != nil {
			log.Printf("lorawan/frames: collection missing: %v", err)
			return e.JSON(http.StatusInternalServerError, map[string]any{"error": "lorawan_frames collection not found; ensure backend migrations have run"})
		}
		records, err := app.FindRecordsByFilter(lorawanFramesCollectionName, "", "-time", limit, 0, nil)
		if err != nil {
			log.Printf("lorawan/frames: list error: %v", err)
			return e.JSON(http.StatusInternalServerError, map[string]any{"error": "failed to list frames: " + err.Error()})
		}
		items := make([]map[string]any, 0, len(records))
		for _, rec := range records {
			items = append(items, recordToFrameMap(rec))
		}
		return e.JSON(http.StatusOK, items)
	}
}

func recordToFrameMap(rec *core.Record) map[string]any {
	getStr := func(k string) string { v := rec.Get(k); s, _ := v.(string); return s }
	getInt := func(k string) int {
		v := rec.Get(k)
		if v == nil {
			return 0
		}
		switch n := v.(type) {
		case float64:
			return int(n)
		case int:
			return n
		case int64:
			return int(n)
		default:
			return 0
		}
	}
	getFloat := func(k string) float64 {
		v := rec.Get(k)
		if v == nil {
			return 0
		}
		switch n := v.(type) {
		case float64:
			return n
		case int:
			return float64(n)
		case int64:
			return float64(n)
		default:
			return 0
		}
	}
	return map[string]any{
		"time":        getStr("time"),
		"direction":   getStr("direction"),
		"dev_eui":     getStr("dev_eui"),
		"f_port":      getInt("f_port"),
		"kind":        getStr("kind"),
		"payload_hex": getStr("payload_hex"),
		"phy_len":     getInt("phy_len"),
		"rssi":        getInt("rssi"),
		"snr":         getFloat("snr"),
		"gateway_id":  getStr("gateway_id"),
		"error":       getStr("error"),
	}
}

// lorawanStatsHandler returns frame buffer stats (from DB) and pipeline status.
// GET /api/farmon/lorawan/stats
func lorawanStatsHandler(app core.App, state *GatewayState) func(*core.RequestEvent) error {
	return func(e *core.RequestEvent) error {
		cfg := state.Config()
		stats := GetFrameStatsFromDB(app)
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

// sendCommandHandler sends a generic downlink command using the device's registered command→fPort mapping.
// POST /api/farmon/sendCommand — { eui, command, value? }
func sendCommandHandler(app core.App, state *GatewayState) func(*core.RequestEvent) error {
	return func(e *core.RequestEvent) error {
		cfg := state.Config()
		if cfg == nil {
			return e.JSON(http.StatusServiceUnavailable, map[string]any{"ok": false, "error": "gateway not configured"})
		}
		var body struct {
			Eui     string  `json:"eui"`
			Command string  `json:"command"`
			Value   *uint32 `json:"value,omitempty"`
		}
		if err := e.BindBody(&body); err != nil {
			return e.String(http.StatusBadRequest, "invalid body")
		}
		if body.Eui == "" || body.Command == "" {
			return e.String(http.StatusBadRequest, "eui and command required")
		}

		// Look up fPort from device's commands_json
		devRec, err := app.FindFirstRecordByFilter("devices",
			"device_eui = {:eui}", dbx.Params{"eui": body.Eui})
		if err != nil {
			return e.JSON(http.StatusNotFound, map[string]any{"ok": false, "error": "device not found"})
		}
		cmdsRaw := devRec.Get("commands_json")
		var cmds map[string]any
		switch v := cmdsRaw.(type) {
		case string:
			if err := json.Unmarshal([]byte(v), &cmds); err != nil {
				return e.JSON(http.StatusBadRequest, map[string]any{"ok": false, "error": "device has no commands registered"})
			}
		case map[string]any:
			cmds = v
		default:
			return e.JSON(http.StatusBadRequest, map[string]any{"ok": false, "error": "device has no commands registered"})
		}
		portVal, ok := cmds[body.Command]
		if !ok {
			return e.JSON(http.StatusBadRequest, map[string]any{"ok": false, "error": "unknown command: " + body.Command})
		}
		fPort := uint8(getFloat64(portVal))

		// Build payload based on command type
		var payload []byte
		if body.Value != nil {
			// For interval command (fPort 11): 4 bytes big-endian milliseconds
			ms := *body.Value * 1000
			payload = []byte{
				byte(ms >> 24), byte(ms >> 16), byte(ms >> 8), byte(ms),
			}
		}
		// Commands without value (reset, reboot, etc.) send empty payload

		if err := EnqueueDownlink(cfg, app, body.Eui, fPort, payload); err != nil {
			return e.JSON(http.StatusInternalServerError, map[string]any{"ok": false, "error": err.Error()})
		}
		return e.JSON(http.StatusOK, map[string]any{"ok": true, "message": "command queued"})
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
