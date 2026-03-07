package main

import (
	"crypto/rand"
	"encoding/hex"
	"net/http"
	"strings"
	"time"

	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/core"
)

// POST /api/devices — create device with generated AppKey (LoRaWAN OTAA provisioning).
// Body: { "device_eui": "0102030405060708", "device_name": "optional name" }
// Returns: { "device_eui": "...", "app_key": "hex32" }
func provisionDeviceHandler(app core.App) func(*core.RequestEvent) error {
	return func(e *core.RequestEvent) error {
		var body struct {
			DeviceEui   string `json:"device_eui"`
			DeviceName  string `json:"device_name"`
		}
		if err := e.BindBody(&body); err != nil {
			return e.String(http.StatusBadRequest, "invalid body")
		}
		devEui := normalizeEui(strings.TrimSpace(body.DeviceEui))
		if len(devEui) != 16 {
			return e.String(http.StatusBadRequest, "device_eui must be 16 hex characters")
		}
		// Generate AppKey (16 bytes = 32 hex chars)
		key := make([]byte, 16)
		if _, err := rand.Read(key); err != nil {
			return e.JSON(http.StatusInternalServerError, map[string]any{"error": "failed to generate key"})
		}
		appKeyHex := hex.EncodeToString(key)
		coll, err := app.FindCollectionByNameOrId("devices")
		if err != nil {
			return e.JSON(http.StatusInternalServerError, map[string]any{"error": err.Error()})
		}
		existing, err := app.FindFirstRecordByFilter("devices", "device_eui = {:eui}", dbx.Params{"eui": devEui})
		if err == nil {
			// Update existing: set app_key if not set, optionally name
			if existing.Get("app_key") == nil || existing.Get("app_key") == "" {
				existing.Set("app_key", appKeyHex)
			} else {
				appKeyHex, _ = existing.Get("app_key").(string)
			}
			if body.DeviceName != "" {
				existing.Set("device_name", strings.TrimSpace(body.DeviceName))
			}
			existing.Set("last_seen", time.Now().Format(time.RFC3339))
			if err := app.Save(existing); err != nil {
				return e.JSON(http.StatusInternalServerError, map[string]any{"error": err.Error()})
			}
			return e.JSON(http.StatusOK, map[string]any{
				"device_eui": devEui,
				"app_key":    appKeyHex,
			})
		}
		rec := core.NewRecord(coll)
		rec.Set("device_eui", devEui)
		rec.Set("device_name", strings.TrimSpace(body.DeviceName))
		rec.Set("app_key", appKeyHex)
		rec.Set("last_seen", time.Now().Format(time.RFC3339))
		if err := app.Save(rec); err != nil {
			return e.JSON(http.StatusInternalServerError, map[string]any{"error": err.Error()})
		}
		return e.JSON(http.StatusOK, map[string]any{
			"device_eui": devEui,
			"app_key":    appKeyHex,
		})
	}
}

// GET /api/devices/credentials?eui=... — return credentials for firmware (e.g. secrets.h).
// Returns: { "device_eui": "...", "app_key": "hex32" }
func deviceCredentialsHandler(app core.App) func(*core.RequestEvent) error {
	return func(e *core.RequestEvent) error {
		eui := normalizeEui(strings.TrimSpace(e.Request.URL.Query().Get("eui")))
		if eui == "" || len(eui) != 16 {
			return e.String(http.StatusBadRequest, "eui query param required (16 hex chars)")
		}
		rec, err := app.FindFirstRecordByFilter("devices", "device_eui = {:eui}", dbx.Params{"eui": eui})
		if err != nil {
			return e.JSON(http.StatusNotFound, map[string]any{"error": "device not found"})
		}
		appKey, _ := rec.Get("app_key").(string)
		if appKey == "" {
			return e.JSON(http.StatusNotFound, map[string]any{"error": "device has no app_key; provision first via POST /api/devices"})
		}
		return e.JSON(http.StatusOK, map[string]any{
			"device_eui": eui,
			"app_key":    appKey,
		})
	}
}
