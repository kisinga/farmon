package main

import (
	"encoding/hex"
	"net/http"

	"github.com/kisinga/farmon/pi/internal/gateway"
	"github.com/pocketbase/pocketbase/core"
)

// POST /api/farmon/test/inject-uplink
// Bypasses ZMQ + LoRaWAN crypto, feeds directly into the uplink handler.
// Body: { "device_eui": "hex16", "fport": 2, "payload_hex": "7064...", "rssi": -85, "snr": 7.5 }
func injectUplinkHandler(app core.App, gw *GatewayState) func(*core.RequestEvent) error {
	return func(e *core.RequestEvent) error {
		var body struct {
			DeviceEUI  string  `json:"device_eui"`
			FPort      uint8   `json:"fport"`
			PayloadHex string  `json:"payload_hex"`
			RSSI       int     `json:"rssi"`
			SNR        float64 `json:"snr"`
		}
		if err := e.BindBody(&body); err != nil {
			return e.String(http.StatusBadRequest, "invalid body")
		}
		devEui := normalizeEui(body.DeviceEUI)
		if len(devEui) != 16 {
			return e.String(http.StatusBadRequest, "device_eui must be 16 hex chars")
		}

		payload, err := hex.DecodeString(body.PayloadHex)
		if err != nil {
			return e.String(http.StatusBadRequest, "invalid payload_hex")
		}

		rssi := body.RSSI
		snr := body.SNR

		// Record in lorawan_frames for monitoring
		RecordUplink(app, devEui, body.FPort, "data", payload, len(payload), &rssi, &snr, "test-sim")

		// Feed into the real uplink handler (decode engine + DB writes + workflows)
		cfg := gw.Config()
		if cfg == nil {
			cfg = &gateway.Config{}
		}
		if err := handleUplinkFromPipeline(app, devEui, "", body.FPort, payload, &rssi, &snr, cfg); err != nil {
			return e.JSON(http.StatusInternalServerError, map[string]any{"error": err.Error()})
		}

		return e.JSON(http.StatusOK, map[string]any{"ok": true})
	}
}
