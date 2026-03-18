package main

import (
	"encoding/hex"
	"fmt"
	"log"
	"net/http"
	"strings"
	"time"

	"github.com/kisinga/farmon/internal/gateway"
	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/core"
)

// ingestHandler handles WiFi device uplinks via HTTP POST.
// Auth: Authorization: Bearer <device_token>
// Body: { "fport": 2, "payload": "text..." } or { "fport": 2, "payload_hex": "aabb..." }
// Response includes any pending commands for the device.
//
// POST /api/farmon/ingest
func ingestHandler(app core.App, gwState *GatewayState, wifiState *WifiState) func(*core.RequestEvent) error {
	return func(e *core.RequestEvent) error {
		// Check WiFi transport enabled
		wifiCfg := wifiState.Config()
		if !wifiCfg.Enabled {
			return e.JSON(http.StatusServiceUnavailable, map[string]any{"error": "WiFi transport is disabled"})
		}

		// Extract bearer token
		auth := e.Request.Header.Get("Authorization")
		if !strings.HasPrefix(auth, "Bearer ") {
			return e.JSON(http.StatusUnauthorized, map[string]any{"error": "missing or invalid Authorization header"})
		}
		token := strings.TrimSpace(strings.TrimPrefix(auth, "Bearer "))
		if token == "" {
			return e.JSON(http.StatusUnauthorized, map[string]any{"error": "empty bearer token"})
		}

		// Look up device by token
		dev, err := app.FindFirstRecordByFilter("devices", "device_token = {:token}", dbx.Params{"token": token})
		if err != nil {
			return e.JSON(http.StatusUnauthorized, map[string]any{"error": "invalid device token"})
		}
		devTransport := dev.GetString("transport")
		if devTransport != "wifi" {
			return e.JSON(http.StatusForbidden, map[string]any{"error": fmt.Sprintf("device transport is %q, not wifi", devTransport)})
		}

		devEUI := dev.GetString("device_eui")
		deviceName := dev.GetString("device_name")
		if deviceName == "" {
			deviceName = devEUI
		}

		// Parse body
		var body struct {
			FPort      uint8  `json:"fport"`
			Payload    string `json:"payload"`
			PayloadHex string `json:"payload_hex"`
		}
		if err := e.BindBody(&body); err != nil {
			return e.JSON(http.StatusBadRequest, map[string]any{"error": "invalid body"})
		}
		if body.FPort == 0 {
			return e.JSON(http.StatusBadRequest, map[string]any{"error": "fport required (> 0)"})
		}

		// Resolve payload bytes
		var payload []byte
		if body.PayloadHex != "" {
			payload, err = hex.DecodeString(body.PayloadHex)
			if err != nil {
				return e.JSON(http.StatusBadRequest, map[string]any{"error": "invalid payload_hex"})
			}
		} else if body.Payload != "" {
			payload = []byte(body.Payload)
		} else {
			return e.JSON(http.StatusBadRequest, map[string]any{"error": "payload or payload_hex required"})
		}

		// Record frame (reuse lorawan_frames for unified monitoring)
		RecordUplink(app, devEUI, body.FPort, "wifi", payload, len(payload), nil, nil, "")

		// Process through the shared pipeline (same path as LoRaWAN uplinks and test-inject)
		cfg := gwState.Config()
		if cfg == nil {
			cfg = &gateway.Config{}
		}
		if err := handleUplinkFromPipeline(app, devEUI, deviceName, body.FPort, payload, nil, nil, cfg); err != nil {
			log.Printf("[ingest] uplink error dev_eui=%s fPort=%d: %v", devEUI, body.FPort, err)
			// Still return OK — the uplink was received, decode/persist may have partial failure
		}

		// Drain pending commands for this device
		commands := drainPendingCommands(app, devEUI)

		testPrefix := ""
		if wifiCfg.TestMode {
			testPrefix = "TEST MODE "
		}
		log.Printf("[ingest] %sdev_eui=%s fPort=%d payload_len=%d pending_cmds=%d", testPrefix, devEUI, body.FPort, len(payload), len(commands))

		return e.JSON(http.StatusOK, map[string]any{
			"ok":       true,
			"commands": commands,
		})
	}
}

// pendingCommandResponse is the shape of a command returned to the device in the ingest response.
type pendingCommandResponse struct {
	CommandKey  string         `json:"command_key"`
	FPort       int            `json:"fport"`
	PayloadHex  string         `json:"payload_hex,omitempty"`
	PayloadJSON map[string]any `json:"payload,omitempty"`
}

// drainPendingCommands finds all pending (non-expired) commands for a device,
// marks them as delivered, and returns them for the ingest response.
func drainPendingCommands(app core.App, devEUI string) []pendingCommandResponse {
	now := time.Now().Format(time.RFC3339)
	records, err := app.FindRecordsByFilter(
		"pending_commands",
		"device_eui = {:eui} && status = 'pending' && (expires_at = '' OR expires_at > {:now})",
		"",
		100, 0,
		dbx.Params{"eui": devEUI, "now": now},
	)
	if err != nil || len(records) == 0 {
		return nil
	}

	result := make([]pendingCommandResponse, 0, len(records))
	for _, rec := range records {
		resp := pendingCommandResponse{
			CommandKey: rec.GetString("command_key"),
			FPort:      int(rec.GetFloat("fport")),
			PayloadHex: rec.GetString("payload_hex"),
		}
		// Include JSON payload if present
		if pj := rec.Get("payload_json"); pj != nil {
			if m, ok := pj.(map[string]any); ok && len(m) > 0 {
				resp.PayloadJSON = m
			}
		}
		result = append(result, resp)
		rec.Set("status", "delivered")
		_ = app.Save(rec)
	}
	return result
}

// enqueueWiFiCommand inserts a pending command for a WiFi device. The command
// will be delivered in the response to the device's next ingest POST.
// If jsonPayload is non-nil, it's stored as payload_json (for structured WiFi commands).
// If payload is non-nil, it's stored as payload_hex (for binary commands).
func enqueueWiFiCommand(app core.App, devEUI string, fPort uint8, payload []byte, jsonPayload ...map[string]any) error {
	coll, err := app.FindCollectionByNameOrId("pending_commands")
	if err != nil {
		return fmt.Errorf("pending_commands collection not found: %w", err)
	}
	rec := core.NewRecord(coll)
	rec.Set("device_eui", devEUI)
	rec.Set("command_key", fmt.Sprintf("fport_%d", fPort))
	rec.Set("fport", fPort)
	if len(payload) > 0 {
		rec.Set("payload_hex", hex.EncodeToString(payload))
	}
	if len(jsonPayload) > 0 && jsonPayload[0] != nil {
		rec.Set("payload_json", jsonPayload[0])
	}
	rec.Set("status", "pending")
	rec.Set("expires_at", time.Now().Add(1*time.Hour).Format(time.RFC3339))
	return app.Save(rec)
}
