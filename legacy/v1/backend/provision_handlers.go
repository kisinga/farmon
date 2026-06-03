package main

import (
	"crypto/rand"
	"encoding/hex"
	"fmt"
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

// POST /api/farmon/devices — provision a device, optionally with an inline spec.
// Body: { "device_eui": "...", "device_name": "...", "transport": "lorawan|wifi", "spec": { ... } }
// If spec is provided, the device config is materialized from it.
// If omitted, a bare device is created with no fields, controls, or airconfig.
func provisionDeviceHandler(app core.App) func(*core.RequestEvent) error {
	return func(e *core.RequestEvent) error {
		var body struct {
			DeviceEui      string      `json:"device_eui"`
			DeviceName     string      `json:"device_name"`
			Transport      string      `json:"transport"`
			HardwareModel  string      `json:"hardware_model"`
			DeviceCategory string      `json:"device_category"` // "farmon" or "external"
			Spec           *DeviceSpec `json:"spec"`
		}
		if err := e.BindBody(&body); err != nil {
			return e.String(http.StatusBadRequest, "invalid body")
		}
		devEui := normalizeEui(strings.TrimSpace(body.DeviceEui))
		transport := strings.TrimSpace(body.Transport)
		if transport == "" {
			transport = "lorawan"
		}
		if transport != "lorawan" && transport != "wifi" {
			return e.String(http.StatusBadRequest, "transport must be 'lorawan' or 'wifi'")
		}

		category := strings.TrimSpace(body.DeviceCategory)
		if category == "" {
			category = "farmon"
		}
		if category != "farmon" && category != "external" {
			return e.String(http.StatusBadRequest, "device_category must be 'farmon' or 'external'")
		}

		// Transport-aware ID validation
		minLen := 16
		if transport == "wifi" {
			minLen = 12
		}
		if len(devEui) < minLen || len(devEui) > 16 {
			return e.String(http.StatusBadRequest, fmt.Sprintf("device_eui must be %d–16 hex characters", minLen))
		}
		for len(devEui) < 16 {
			devEui = "0" + devEui
		}

		// Generate credentials based on transport
		var appKeyHex, deviceToken string
		switch transport {
		case "lorawan":
			key := make([]byte, 16)
			if _, err := rand.Read(key); err != nil {
				return e.JSON(http.StatusInternalServerError, map[string]any{"error": "failed to generate key"})
			}
			appKeyHex = hex.EncodeToString(key)
		case "wifi":
			token := make([]byte, 32)
			if _, err := rand.Read(token); err != nil {
				return e.JSON(http.StatusInternalServerError, map[string]any{"error": "failed to generate token"})
			}
			deviceToken = hex.EncodeToString(token)
		}

		coll, err := app.FindCollectionByNameOrId("devices")
		if err != nil {
			return e.JSON(http.StatusInternalServerError, map[string]any{"error": err.Error()})
		}

		// Determine config_status and device_type from spec
		configStatus := "n/a"
		deviceType := ""
		if body.Spec != nil {
			deviceType = body.Spec.Type
			if deviceType == "airconfig" {
				configStatus = "pending"
			}
		}

		existing, err := app.FindFirstRecordByFilter("devices", "device_eui = {:eui}", dbx.Params{"eui": devEui})
		if err == nil {
			// Device already exists — update
			if transport == "lorawan" {
				if existing.Get("app_key") == nil || existing.Get("app_key") == "" {
					existing.Set("app_key", appKeyHex)
				} else {
					appKeyHex = appKey32(existing.Get("app_key").(string))
					existing.Set("app_key", appKeyHex)
				}
				existing.Set("device_token", "")
			} else {
				existing.Set("device_token", deviceToken)
				existing.Set("app_key", "")
			}
			if body.DeviceName != "" {
				existing.Set("device_name", strings.TrimSpace(body.DeviceName))
			}
			if body.Spec != nil {
				existing.Set("device_type", deviceType)
			}
			if body.HardwareModel != "" {
				existing.Set("hardware_model", body.HardwareModel)
			}
			existing.Set("config_status", configStatus)
			existing.Set("transport", transport)
			existing.Set("device_category", category)
			existing.Set("last_seen", time.Now().Format(time.RFC3339))
			if err := app.Save(existing); err != nil {
				return e.JSON(http.StatusInternalServerError, map[string]any{"error": err.Error()})
			}
		} else {
			// Create new device
			rec := core.NewRecord(coll)
			rec.Set("device_eui", devEui)
			rec.Set("device_name", strings.TrimSpace(body.DeviceName))
			rec.Set("device_type", deviceType)
			rec.Set("device_category", category)
			rec.Set("config_status", configStatus)
			rec.Set("transport", transport)
			if body.HardwareModel != "" {
				rec.Set("hardware_model", body.HardwareModel)
			}
			if transport == "lorawan" {
				rec.Set("app_key", appKeyHex)
			} else {
				rec.Set("device_token", deviceToken)
			}
			rec.Set("last_seen", time.Now().Format(time.RFC3339))
			if err := app.Save(rec); err != nil {
				return e.JSON(http.StatusInternalServerError, map[string]any{"error": err.Error()})
			}
		}

		// Materialize spec to device-level collections
		if body.Spec != nil {
			if err := materializeSpecToDevice(app, devEui, body.Spec); err != nil {
				log.Printf("[provision] materialize error for %s: %v", devEui, err)
			}
		}

		// Ensure device_airconfig record exists (stub if not created by spec).
		// Skip for external devices — they don't use airconfig.
		if category == "farmon" {
			if _, err := app.FindFirstRecordByFilter("device_airconfig",
				"device_eui = {:eui}", dbx.Params{"eui": devEui}); err != nil {
				if acColl, err2 := app.FindCollectionByNameOrId("device_airconfig"); err2 == nil {
					stub := core.NewRecord(acColl)
					stub.Set("device_eui", devEui)
					stub.Set("pin_map", []any{})
					stub.Set("sensors", []any{})
					stub.Set("controls", []any{})
					stub.Set("lorawan", map[string]any{})
					_ = app.Save(stub)
				}
			}
		}

		resp := map[string]any{
			"device_eui": devEui,
			"transport":  transport,
		}
		if transport == "lorawan" {
			resp["app_key"] = appKeyHex
		} else if transport == "wifi" {
			resp["device_token"] = deviceToken
		}
		return e.JSON(http.StatusOK, resp)
	}
}

// DELETE /api/farmon/devices?eui=... — delete a device and all its related records.
func deleteDeviceHandler(app core.App) func(*core.RequestEvent) error {
	return func(e *core.RequestEvent) error {
		eui := normalizeEui(strings.TrimSpace(e.Request.URL.Query().Get("eui")))
		if eui == "" || len(eui) < 12 || len(eui) > 16 {
			return e.String(http.StatusBadRequest, "eui query param required (12–16 hex chars)")
		}
		for len(eui) < 16 {
			eui = "0" + eui
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
		deleteRelatedRecords(app, "device_airconfig", eui)
		deleteRelatedRecords(app, "device_decode_rules", eui)
		deleteRelatedRecords(app, "device_commands", eui)
		deleteRelatedRecords(app, "device_visualizations", eui)
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
