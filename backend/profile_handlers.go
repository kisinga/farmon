package main

import (
	"encoding/hex"
	"net/http"

	"github.com/pocketbase/pocketbase/core"
)

// GET /api/farmon/profiles — list all profiles (templates only by default, or all).
// Optional ?transport=lorawan|wifi — filter to profiles compatible with the given transport.
func listProfilesHandler(app core.App) func(*core.RequestEvent) error {
	return func(e *core.RequestEvent) error {
		filter := "is_template = true"
		if e.Request.URL.Query().Get("all") == "true" {
			filter = ""
		}
		records, err := app.FindRecordsByFilter("device_profiles", filter, "name", 0, 0)
		if err != nil {
			return e.JSON(http.StatusInternalServerError, map[string]any{"error": err.Error()})
		}
		transportFilter := e.Request.URL.Query().Get("transport")
		var profiles []map[string]any
		for _, r := range records {
			pt := r.GetString("transport")
			if transportFilter != "" && !isProfileCompatible(pt, transportFilter) {
				continue
			}
			profiles = append(profiles, map[string]any{
				"id":           r.Id,
				"name":         r.GetString("name"),
				"description":  r.GetString("description"),
				"profile_type": r.GetString("profile_type"),
				"transport":    pt,
				"is_template":  r.GetBool("is_template"),
				"created":      r.GetString("created"),
				"updated":      r.GetString("updated"),
			})
		}
		if profiles == nil {
			profiles = []map[string]any{}
		}
		return e.JSON(http.StatusOK, profiles)
	}
}

// GET /api/farmon/profiles/{id} — get profile with all sub-components.
func getProfileHandler(app core.App) func(*core.RequestEvent) error {
	return func(e *core.RequestEvent) error {
		id := e.Request.PathValue("id")
		if id == "" {
			return e.String(http.StatusBadRequest, "profile id required")
		}
		profile, err := loadProfileWithComponents(app, id)
		if err != nil {
			return e.JSON(http.StatusNotFound, map[string]any{"error": err.Error()})
		}
		return e.JSON(http.StatusOK, profile)
	}
}

// POST /api/farmon/profiles — create a new profile (metadata only, sub-components added separately via SDK).
func createProfileHandler(app core.App) func(*core.RequestEvent) error {
	return func(e *core.RequestEvent) error {
		var body struct {
			Name        string `json:"name"`
			Description string `json:"description"`
			ProfileType string `json:"profile_type"`
			Transport   string `json:"transport"`
			IsTemplate  bool   `json:"is_template"`
		}
		if err := e.BindBody(&body); err != nil {
			return e.String(http.StatusBadRequest, "invalid body")
		}
		if body.Name == "" || body.ProfileType == "" {
			return e.String(http.StatusBadRequest, "name and profile_type required")
		}
		if body.ProfileType != "airconfig" && body.ProfileType != "codec" {
			return e.String(http.StatusBadRequest, "profile_type must be 'airconfig' or 'codec'")
		}
		id := createProfile(app, body.Name, body.Description, body.ProfileType, body.IsTemplate, body.Transport)
		if id == "" {
			return e.JSON(http.StatusInternalServerError, map[string]any{"error": "failed to create profile"})
		}
		return e.JSON(http.StatusCreated, map[string]any{"id": id, "name": body.Name, "transport": body.Transport})
	}
}

// PATCH /api/farmon/profiles/{id} — update profile metadata.
func updateProfileHandler(app core.App) func(*core.RequestEvent) error {
	return func(e *core.RequestEvent) error {
		id := e.Request.PathValue("id")
		rec, err := app.FindRecordById("device_profiles", id)
		if err != nil {
			return e.JSON(http.StatusNotFound, map[string]any{"error": "profile not found"})
		}
		var body map[string]any
		if err := e.BindBody(&body); err != nil {
			return e.String(http.StatusBadRequest, "invalid body")
		}
		if v, ok := body["name"].(string); ok && v != "" {
			rec.Set("name", v)
		}
		if v, ok := body["description"].(string); ok {
			rec.Set("description", v)
		}
		if v, ok := body["is_template"].(bool); ok {
			rec.Set("is_template", v)
		}
		if v, ok := body["transport"].(string); ok {
			rec.Set("transport", v)
		}
		if err := app.Save(rec); err != nil {
			return e.JSON(http.StatusInternalServerError, map[string]any{"error": err.Error()})
		}
		return e.JSON(http.StatusOK, map[string]any{"id": rec.Id})
	}
}

// DELETE /api/farmon/profiles/{id} — delete profile (cascade deletes sub-components).
func deleteProfileHandler(app core.App) func(*core.RequestEvent) error {
	return func(e *core.RequestEvent) error {
		id := e.Request.PathValue("id")
		rec, err := app.FindRecordById("device_profiles", id)
		if err != nil {
			return e.JSON(http.StatusNotFound, map[string]any{"error": "profile not found"})
		}
		if err := app.Delete(rec); err != nil {
			return e.JSON(http.StatusInternalServerError, map[string]any{"error": err.Error()})
		}
		return e.JSON(http.StatusOK, map[string]any{"ok": true})
	}
}

// POST /api/farmon/profiles/{id}/test-decode — test decode rules with sample payload.
// Body: { "fport": 2, "payload_hex": "..." } or { "message_type": 2, "payload_hex": "..." }
func testDecodeHandler(app core.App) func(*core.RequestEvent) error {
	return func(e *core.RequestEvent) error {
		id := e.Request.PathValue("id")
		profile, err := loadProfileWithComponents(app, id)
		if err != nil {
			return e.JSON(http.StatusNotFound, map[string]any{"error": err.Error()})
		}

		var body struct {
			FPort       int    `json:"fport"`
			MessageType int    `json:"message_type"`
			PayloadHex  string `json:"payload_hex"`
		}
		if err := e.BindBody(&body); err != nil {
			return e.String(http.StatusBadRequest, "invalid body")
		}

		// Allow message_type as alias for fport
		fport := body.FPort
		if fport == 0 && body.MessageType > 0 {
			fport = body.MessageType
		}
		rule := getDecodeRuleForFPort(profile, fport)
		if rule == nil {
			return e.JSON(http.StatusBadRequest, map[string]any{"error": "no decode rule for fport " + string(rune(body.FPort+'0'))})
		}

		payload, err := hex.DecodeString(body.PayloadHex)
		if err != nil {
			return e.JSON(http.StatusBadRequest, map[string]any{"error": "invalid hex: " + err.Error()})
		}

		result, err := DecodeWithRules(rule.Format, rule.Config, profile.Fields, payload)
		if err != nil {
			return e.JSON(http.StatusBadRequest, map[string]any{"error": err.Error()})
		}

		return e.JSON(http.StatusOK, map[string]any{
			"format": rule.Format,
			"fport":  body.FPort,
			"result": result.Fields,
		})
	}
}

// POST /api/farmon/devices/{eui}/push-config — trigger AirConfig push for a device.
func pushConfigHandler(app core.App, gwState *GatewayState) func(*core.RequestEvent) error {
	return func(e *core.RequestEvent) error {
		eui := e.Request.PathValue("eui")
		if eui == "" {
			return e.String(http.StatusBadRequest, "eui required")
		}
		eui = normalizeEui(eui)

		profile, err := loadProfileForDevice(app, eui)
		if err != nil {
			return e.JSON(http.StatusNotFound, map[string]any{"error": err.Error()})
		}
		if profile.ProfileType != "airconfig" || profile.AirConfig == nil {
			return e.JSON(http.StatusBadRequest, map[string]any{"error": "device profile is not airconfig type"})
		}

		dev, err := app.FindFirstRecordByFilter("devices", "device_eui = {:eui}", nil)
		if err != nil {
			return e.JSON(http.StatusNotFound, map[string]any{"error": "device not found"})
		}

		overridesJSON := dev.GetString("config_overrides")
		effective, err := getEffectiveAirConfig(profile, overridesJSON)
		if err != nil {
			return e.JSON(http.StatusInternalServerError, map[string]any{"error": err.Error()})
		}

		cfg := gwState.Config()
		if cfg == nil || !cfg.Valid() {
			return e.JSON(http.StatusServiceUnavailable, map[string]any{"error": "gateway not configured"})
		}

		if pushErr := pushAirConfig(app, cfg, eui, effective); pushErr != nil {
			return e.JSON(http.StatusInternalServerError, map[string]any{"error": pushErr.Error()})
		}

		dev.Set("config_status", "pending")
		_ = app.Save(dev)

		return e.JSON(http.StatusOK, map[string]any{"ok": true, "config_hash": computeConfigHash(effective)})
	}
}

// PATCH /api/farmon/devices/{eui}/overrides — update per-device config_overrides.
func updateDeviceOverridesHandler(app core.App) func(*core.RequestEvent) error {
	return func(e *core.RequestEvent) error {
		eui := normalizeEui(e.Request.PathValue("eui"))
		if eui == "" {
			return e.String(http.StatusBadRequest, "eui required")
		}

		var body struct {
			Overrides map[string]any `json:"overrides"`
		}
		if err := e.BindBody(&body); err != nil {
			return e.String(http.StatusBadRequest, "invalid body")
		}

		dev, err := app.FindFirstRecordByFilter("devices", "device_eui = {:eui}", nil)
		if err != nil {
			return e.JSON(http.StatusNotFound, map[string]any{"error": "device not found"})
		}

		dev.Set("config_overrides", body.Overrides)
		dev.Set("config_status", "pending")
		if err := app.Save(dev); err != nil {
			return e.JSON(http.StatusInternalServerError, map[string]any{"error": err.Error()})
		}

		return e.JSON(http.StatusOK, map[string]any{"ok": true})
	}
}
