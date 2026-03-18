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

// POST /api/farmon/devices — provision a device, optionally from a template.
// Body: { "device_eui": "...", "device_name": "...", "template_id": "optional", "profile_id": "optional (alias for template_id)", "transport": "lorawan|wifi", "target_id": "..." }
// If template_id/profile_id is provided, the device is materialized from that template.
// If omitted, a bare device is created with no fields, controls, or airconfig.
func provisionDeviceHandler(app core.App) func(*core.RequestEvent) error {
	return func(e *core.RequestEvent) error {
		var body struct {
			DeviceEui  string `json:"device_eui"`
			DeviceName string `json:"device_name"`
			TemplateID string `json:"template_id"`
			ProfileID  string `json:"profile_id"` // backward compat alias for template_id
			Transport  string `json:"transport"`
			TargetID   string `json:"target_id"`
		}
		if err := e.BindBody(&body); err != nil {
			return e.String(http.StatusBadRequest, "invalid body")
		}
		devEui := normalizeEui(strings.TrimSpace(body.DeviceEui))
		// Transport-aware ID validation: LoRaWAN requires exactly 16 hex (EUI-64),
		// WiFi allows 12-16 hex (MAC or padded). Zero-pad short IDs to 16 for uniformity.
		transport := strings.TrimSpace(body.Transport)
		minLen := 16
		if transport == "wifi" {
			minLen = 12
		}
		if len(devEui) < minLen || len(devEui) > 16 {
			return e.String(http.StatusBadRequest, fmt.Sprintf("device_eui must be %d–16 hex characters", minLen))
		}
		for len(devEui) < 16 {
			devEui = "0" + devEui // zero-pad WiFi MACs to 16 chars
		}

		// Resolve template_id (accept both template_id and profile_id for backward compat)
		templateID := body.TemplateID
		if templateID == "" {
			templateID = body.ProfileID
		}

		// Resolve transport from target catalog if not explicitly set
		targetID := strings.TrimSpace(body.TargetID)
		if transport == "" && targetID != "" {
			if t := findDeviceTarget(targetID); t != nil && t.Transport != "" {
				transport = t.Transport
			}
		}
		if transport == "" {
			transport = "lorawan" // backward compat default
		}
		if transport != "lorawan" && transport != "wifi" {
			return e.String(http.StatusBadRequest, "transport must be 'lorawan' or 'wifi'")
		}

		// Load template if provided
		var tmpl *TemplateWithComponents
		var warning string
		if templateID != "" {
			var err error
			tmpl, err = loadTemplateWithComponents(app, templateID)
			if err != nil {
				return e.JSON(http.StatusBadRequest, map[string]any{"error": "template not found: " + templateID})
			}
			// Check template-transport compatibility (warn, don't block)
			if !isTemplateCompatible(tmpl.Transport, transport) {
				warning = fmt.Sprintf("template %q is %s-only but device transport is %s", tmpl.Name, tmpl.Transport, transport)
				log.Printf("[provision] warning: %s", warning)
			}
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

		// Determine config_status and device_type
		configStatus := "n/a"
		deviceType := ""
		if tmpl != nil {
			deviceType = tmpl.ProfileType
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
			if templateID != "" {
				existing.Set("provisioned_from", templateID)
				existing.Set("device_type", deviceType)
			}
			existing.Set("config_status", configStatus)
			existing.Set("transport", transport)
			existing.Set("target_id", targetID)
			existing.Set("last_seen", time.Now().Format(time.RFC3339))
			if err := app.Save(existing); err != nil {
				return e.JSON(http.StatusInternalServerError, map[string]any{"error": err.Error()})
			}
		} else {
			// Create new device
			rec := core.NewRecord(coll)
			rec.Set("device_eui", devEui)
			rec.Set("device_name", strings.TrimSpace(body.DeviceName))
			rec.Set("provisioned_from", templateID)
			rec.Set("device_type", deviceType)
			rec.Set("config_status", configStatus)
			rec.Set("transport", transport)
			rec.Set("target_id", targetID)
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

		// Materialize template to device-level collections (only if template provided)
		if tmpl != nil {
			if err := materializeTemplateToDevice(app, devEui, tmpl); err != nil {
				log.Printf("[provision] materialize error for %s: %v", devEui, err)
			}
		}

		resp := map[string]any{
			"device_eui": devEui,
			"transport":  transport,
		}
		if tmpl != nil {
			resp["template_name"] = tmpl.Name
		}
		if transport == "lorawan" {
			resp["app_key"] = appKeyHex
		} else if transport == "wifi" {
			resp["device_token"] = deviceToken
		}
		if warning != "" {
			resp["warning"] = warning
		}
		return e.JSON(http.StatusOK, resp)
	}
}

// DELETE /api/farmon/devices?eui=... — delete a device, its LoRaWAN session, fields, controls, and commands.
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

// POST /api/farmon/devices/{eui}/apply-template — re-apply a template, resetting all device-level data.
func applyTemplateHandler(app core.App) func(*core.RequestEvent) error {
	return func(e *core.RequestEvent) error {
		eui := normalizeEui(e.Request.PathValue("eui"))
		if eui == "" {
			return e.String(http.StatusBadRequest, "eui required")
		}

		var body struct {
			TemplateID string `json:"template_id"`
		}
		if err := e.BindBody(&body); err != nil || body.TemplateID == "" {
			return e.String(http.StatusBadRequest, "template_id required")
		}

		dev, err := app.FindFirstRecordByFilter("devices", "device_eui = {:eui}", dbx.Params{"eui": eui})
		if err != nil {
			return e.JSON(http.StatusNotFound, map[string]any{"error": "device not found"})
		}

		tmpl, err := loadTemplateWithComponents(app, body.TemplateID)
		if err != nil {
			return e.JSON(http.StatusBadRequest, map[string]any{"error": "template not found: " + body.TemplateID})
		}

		// Full reset materialization
		if err := materializeTemplateToDevice(app, eui, tmpl); err != nil {
			return e.JSON(http.StatusInternalServerError, map[string]any{"error": err.Error()})
		}

		// Update device metadata
		dev.Set("provisioned_from", body.TemplateID)
		dev.Set("device_type", tmpl.ProfileType)
		configStatus := "n/a"
		if tmpl.ProfileType == "airconfig" {
			configStatus = "pending"
		}
		dev.Set("config_status", configStatus)
		if err := app.Save(dev); err != nil {
			return e.JSON(http.StatusInternalServerError, map[string]any{"error": err.Error()})
		}

		return e.JSON(http.StatusOK, map[string]any{
			"ok":            true,
			"template_name": tmpl.Name,
			"config_status": configStatus,
		})
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
