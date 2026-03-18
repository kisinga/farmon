package main

import (
	"encoding/hex"
	"encoding/json"
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

// POST /api/farmon/devices/{eui}/push-rules — build v2 binary rules and enqueue as downlink (fPort 30).
func pushRulesHandler(app core.App, gwState *GatewayState) func(*core.RequestEvent) error {
	return func(e *core.RequestEvent) error {
		eui := normalizeEui(e.Request.PathValue("eui"))
		if eui == "" {
			return e.String(http.StatusBadRequest, "eui required")
		}

		records, err := app.FindRecordsByFilter("device_rules", "device_eui = {:eui} && enabled = true", "rule_id", 0, 0, map[string]any{"eui": eui})
		if err != nil || len(records) == 0 {
			return e.JSON(http.StatusOK, map[string]any{"ok": true, "rules_pushed": 0, "message": "no enabled rules"})
		}

		ruleMaps, extras, windowActive := extractRuleData(records)

		payload, err := buildRuleBatchPayload(ruleMaps, extras, windowActive)
		if err != nil {
			return e.JSON(http.StatusUnprocessableEntity, map[string]any{
				"error":   "too_many_rules",
				"count":   len(ruleMaps),
				"max":     9,
				"message": "LoRaWAN payload fits max 9 rules (222 bytes / 24 bytes per rule). Disable extra rules or use Server Workflows for additional logic.",
			})
		}

		cfg := gwState.Config()
		if err := EnqueueDownlinkForDevice(app, cfg, eui, 30, payload); err != nil {
			return e.JSON(http.StatusInternalServerError, map[string]any{"error": err.Error()})
		}

		for _, rec := range records {
			rec.Set("synced_at", "synced")
			_ = app.Save(rec)
		}

		return e.JSON(http.StatusOK, map[string]any{"ok": true, "rules_pushed": len(records)})
	}
}

// extractRuleData reads rule records from DB and returns the data needed for binary encoding.
func extractRuleData(records []*core.Record) ([]map[string]any, [][]ExtraConditionMap, []bool) {
	ruleMaps := make([]map[string]any, 0, len(records))
	extras := make([][]ExtraConditionMap, 0, len(records))
	windowActive := make([]bool, 0, len(records))

	for _, rec := range records {
		ruleMaps = append(ruleMaps, map[string]any{
			"rule_id":          rec.GetFloat("rule_id"),
			"enabled":          rec.GetBool("enabled"),
			"operator":         rec.GetString("operator"),
			"field_idx":        rec.GetFloat("field_idx"),
			"threshold":        rec.GetFloat("threshold"),
			"control_idx":      rec.GetFloat("control_idx"),
			"action_state":     rec.GetFloat("action_state"),
			"cooldown_seconds": rec.GetFloat("cooldown_seconds"),
			"priority":         rec.GetFloat("priority"),
			"action_dur_x10s":  rec.GetFloat("action_dur_x10s"),
		})

		// Parse extra_conditions JSON array
		var ec []ExtraConditionMap
		raw := rec.Get("extra_conditions")
		if arr, ok := raw.([]any); ok {
			for _, item := range arr {
				if m, ok := item.(map[string]any); ok {
					ec = append(ec, ExtraConditionMap{
						FieldIdx:  toInt(m["field_idx"]),
						Operator:  toString(m["operator"]),
						Threshold: toUint8(m["threshold"]),
						IsControl: toBool(m["is_control"]),
						Logic:     toString(m["logic"]),
					})
				}
			}
		}
		extras = append(extras, ec)

		// window_active defaults to true if not set
		wa := rec.GetBool("window_active")
		if rec.Get("window_active") == nil {
			wa = true
		}
		windowActive = append(windowActive, wa)
	}

	return ruleMaps, extras, windowActive
}

// POST /api/farmon/devices/{eui}/push-sensor-slot — configure a single sensor slot via AirConfig downlink.
// Body: { slot, type, pin_index, field_index, flags, calib_offset, calib_span }
// calib_offset/calib_span are physical-unit floats; handler encodes to int16×10 / uint16×10 for Param1/Param2.
// For non-ADC sensor types, pass raw param1 and param2 integers instead (fields ignored for those types).
func pushSensorSlotHandler(app core.App, gwState *GatewayState) func(*core.RequestEvent) error {
	return func(e *core.RequestEvent) error {
		eui := normalizeEui(e.Request.PathValue("eui"))
		if eui == "" {
			return e.String(http.StatusBadRequest, "eui required")
		}

		var body struct {
			Slot        uint8   `json:"slot"`
			Type        uint8   `json:"type"`
			PinIndex    uint8   `json:"pin_index"`
			FieldIndex  uint8   `json:"field_index"`
			Flags       uint8   `json:"flags"`
			CalibOffset float64 `json:"calib_offset"` // physical value at zero input → Param1 as int16×10
			CalibSpan   float64 `json:"calib_span"`   // physical range (max-min) → Param2 as uint16×10
			Param1Raw   *uint16 `json:"param1_raw"`   // override: use raw uint16 instead of CalibOffset encoding
			Param2Raw   *uint16 `json:"param2_raw"`   // override: use raw uint16 instead of CalibSpan encoding
		}
		if err := e.BindBody(&body); err != nil {
			return e.String(http.StatusBadRequest, "invalid body")
		}
		if body.Slot >= 8 {
			return e.String(http.StatusBadRequest, "slot must be 0-7")
		}

		// Encode Param1/Param2 from calibration floats (int16×10 / uint16×10) unless raw override provided.
		var param1, param2 uint16
		if body.Param1Raw != nil {
			param1 = *body.Param1Raw
		} else {
			p1 := int16(body.CalibOffset * 10)
			param1 = uint16(p1)
		}
		if body.Param2Raw != nil {
			param2 = *body.Param2Raw
		} else {
			p2 := body.CalibSpan * 10
			if p2 < 0 {
				p2 = 0
			}
			param2 = uint16(p2)
		}

		// AirCfgSensor (0x04) payload: [cmd, slot, type, pin_idx, field_idx, flags, p1lo, p1hi, p2lo, p2hi]
		payload := []byte{
			0x04,
			body.Slot,
			body.Type,
			body.PinIndex,
			body.FieldIndex,
			body.Flags,
			byte(param1),
			byte(param1 >> 8),
			byte(param2),
			byte(param2 >> 8),
		}

		cfg := gwState.Config()
		if cfg == nil || !cfg.Valid() {
			return e.JSON(http.StatusServiceUnavailable, map[string]any{"error": "gateway not configured"})
		}
		if err := EnqueueDownlinkForDevice(app, cfg, eui, 35, payload); err != nil {
			return e.JSON(http.StatusInternalServerError, map[string]any{"error": err.Error()})
		}
		return e.JSON(http.StatusOK, map[string]any{"ok": true, "param1": param1, "param2": param2})
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

// POST /api/farmon/validate-airconfig — validate an airconfig for pin conflicts, field overlaps, etc.
// Accepts raw airconfig JSON body: { "pin_map": [...], "sensors": [...], "controls": [...] }
// Returns { "errors": [...], "warnings": [...] }
func validateAirConfigHandler() func(*core.RequestEvent) error {
	return func(e *core.RequestEvent) error {
		var body struct {
			PinMap   json.RawMessage `json:"pin_map"`
			Sensors  json.RawMessage `json:"sensors"`
			Controls json.RawMessage `json:"controls"`
			LoRaWAN  json.RawMessage `json:"lorawan"`
			Transfer json.RawMessage `json:"transfer"`
		}
		if err := e.BindBody(&body); err != nil {
			return e.String(http.StatusBadRequest, "invalid body")
		}

		ac := &ProfileAirConfig{
			PinMap:   body.PinMap,
			Sensors:  body.Sensors,
			Controls: body.Controls,
			LoRaWAN:  body.LoRaWAN,
			Transfer: body.Transfer,
		}

		results := ValidateAirConfig(ac)

		var errors, warnings []ValidationError
		for _, r := range results {
			if r.Severity == "error" {
				errors = append(errors, r)
			} else {
				warnings = append(warnings, r)
			}
		}
		if errors == nil {
			errors = []ValidationError{}
		}
		if warnings == nil {
			warnings = []ValidationError{}
		}

		return e.JSON(http.StatusOK, map[string]any{
			"errors":   errors,
			"warnings": warnings,
		})
	}
}
