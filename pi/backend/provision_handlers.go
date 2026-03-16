package main

import (
	"crypto/rand"
	"encoding/hex"
	"log"
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

// POST /api/farmon/devices — provision device with profile.
// Body: { "device_eui": "0102030405060708", "device_name": "optional name", "profile_id": "required" }
// Returns: { "device_eui": "...", "app_key": "hex32", "profile_name": "..." }
func provisionDeviceHandler(app core.App) func(*core.RequestEvent) error {
	return func(e *core.RequestEvent) error {
		var body struct {
			DeviceEui       string         `json:"device_eui"`
			DeviceName      string         `json:"device_name"`
			ProfileID       string         `json:"profile_id"`
			ConfigOverrides map[string]any `json:"config_overrides,omitempty"`
		}
		if err := e.BindBody(&body); err != nil {
			return e.String(http.StatusBadRequest, "invalid body")
		}
		devEui := normalizeEui(strings.TrimSpace(body.DeviceEui))
		if len(devEui) != 16 {
			return e.String(http.StatusBadRequest, "device_eui must be 16 hex characters")
		}
		if body.ProfileID == "" {
			return e.String(http.StatusBadRequest, "profile_id required")
		}

		// Validate profile exists
		profile, err := loadProfileWithComponents(app, body.ProfileID)
		if err != nil {
			return e.JSON(http.StatusBadRequest, map[string]any{"error": "profile not found: " + body.ProfileID})
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

		// Determine config_status
		configStatus := "n/a"
		if profile.ProfileType == "airconfig" {
			configStatus = "pending"
		}

		existing, err := app.FindFirstRecordByFilter("devices", "device_eui = {:eui}", dbx.Params{"eui": devEui})
		if err == nil {
			// Device already exists — update profile and re-materialize
			if existing.Get("app_key") == nil || existing.Get("app_key") == "" {
				existing.Set("app_key", appKeyHex)
			} else {
				appKeyHex = appKey32(existing.Get("app_key").(string))
				existing.Set("app_key", appKeyHex)
			}
			if body.DeviceName != "" {
				existing.Set("device_name", strings.TrimSpace(body.DeviceName))
			}
			existing.Set("profile", body.ProfileID)
			existing.Set("config_status", configStatus)
			if body.ConfigOverrides != nil {
				existing.Set("config_overrides", body.ConfigOverrides)
			}
			existing.Set("last_seen", time.Now().Format(time.RFC3339))
			if err := app.Save(existing); err != nil {
				return e.JSON(http.StatusInternalServerError, map[string]any{"error": err.Error()})
			}
		} else {
			// Create new device
			rec := core.NewRecord(coll)
			rec.Set("device_eui", devEui)
			rec.Set("device_name", strings.TrimSpace(body.DeviceName))
			rec.Set("app_key", appKeyHex)
			rec.Set("profile", body.ProfileID)
			rec.Set("config_status", configStatus)
			if body.ConfigOverrides != nil {
				rec.Set("config_overrides", body.ConfigOverrides)
			}
			rec.Set("last_seen", time.Now().Format(time.RFC3339))
			if err := app.Save(rec); err != nil {
				return e.JSON(http.StatusInternalServerError, map[string]any{"error": err.Error()})
			}
		}

		// Materialize profile fields/controls to device-level collections
		if err := materializeProfileToDevice(app, devEui, profile); err != nil {
			log.Printf("[provision] materialize error for %s: %v", devEui, err)
		}

		return e.JSON(http.StatusOK, map[string]any{
			"device_eui":   devEui,
			"app_key":      appKeyHex,
			"profile_name": profile.Name,
		})
	}
}

// DELETE /api/farmon/devices?eui=... — delete a device, its LoRaWAN session, fields, controls, and commands.
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

		// Cleanup related records
		deleteRelatedRecords(app, "lorawan_sessions", eui)
		deleteRelatedRecords(app, "device_fields", eui)
		deleteRelatedRecords(app, "device_controls", eui)
		deleteRelatedRecords(app, "commands", eui)

		return e.JSON(http.StatusOK, map[string]any{"ok": true, "message": "device deleted"})
	}
}

func deleteRelatedRecords(app core.App, collection, devEUI string) {
	records, err := app.FindRecordsByFilter(collection, "device_eui = {:eui}", "", 0, 0, dbx.Params{"eui": devEUI})
	if err != nil {
		return
	}
	for _, r := range records {
		_ = app.Delete(r)
	}
}
