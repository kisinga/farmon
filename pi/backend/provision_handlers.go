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

// appKey32 returns exactly 32 hex chars from s (LoRaWAN AppKey is 16 bytes).
func appKey32(s string) string {
	s = strings.TrimSpace(strings.TrimPrefix(s, "0x"))
	var out []byte
	for _, c := range s {
		if c >= '0' && c <= '9' || c >= 'a' && c <= 'f' {
			out = append(out, byte(c))
		} else if c >= 'A' && c <= 'F' {
			out = append(out, byte(c-'A'+'a'))
		}
		if len(out) == 32 {
			return string(out)
		}
	}
	return string(out)
}

// POST /api/farmon/devices — create device with generated AppKey (LoRaWAN OTAA provisioning).
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
			if existing.Get("app_key") == nil || existing.Get("app_key") == "" {
				existing.Set("app_key", appKeyHex)
			} else {
				appKeyHex = appKey32(existing.Get("app_key").(string))
				existing.Set("app_key", appKeyHex)
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

// DELETE /api/farmon/devices?eui=... — delete a device and its LoRaWAN session so it can be re-provisioned.
func deleteDeviceHandler(app core.App) func(*core.RequestEvent) error {
	return func(e *core.RequestEvent) error {
		eui := normalizeEui(strings.TrimSpace(e.Request.URL.Query().Get("eui")))
		if eui == "" || len(eui) != 16 {
			return e.String(http.StatusBadRequest, "eui query param required (16 hex chars)")
		}
		rec, err := app.FindFirstRecordByFilter("devices", "device_eui = {:eui}", dbx.Params{"eui": eui})
		if err != nil {
			return e.JSON(http.StatusNotFound, map[string]any{"error": "device not found"})
		}
		if err := app.Delete(rec); err != nil {
			return e.JSON(http.StatusInternalServerError, map[string]any{"error": err.Error()})
		}
		// Remove LoRaWAN session so the device can join again with a new AppKey.
		if sess, err := app.FindFirstRecordByFilter("lorawan_sessions", "device_eui = {:eui}", dbx.Params{"eui": eui}); err == nil {
			_ = app.Delete(sess)
		}
		return e.JSON(http.StatusOK, map[string]any{"ok": true, "message": "device deleted"})
	}
}

// Credentials are read via SDK: devices.getFirstListItem(filter by device_eui), map to { device_eui, app_key }.
