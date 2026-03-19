package main

import (
	"encoding/hex"
	"encoding/json"
	"net/http"

	"github.com/pocketbase/pocketbase/core"
)

// GET /api/farmon/devices/{eui}/spec — return the device's current config as a DeviceSpec JSON.
func getDeviceSpecHandler(app core.App) func(*core.RequestEvent) error {
	return func(e *core.RequestEvent) error {
		eui := normalizeEui(e.Request.PathValue("eui"))
		if eui == "" {
			return e.String(http.StatusBadRequest, "eui required")
		}
		spec, err := loadDeviceSpec(app, eui)
		if err != nil {
			return e.JSON(http.StatusNotFound, map[string]any{"error": err.Error()})
		}
		return e.JSON(http.StatusOK, spec)
	}
}

// POST /api/farmon/devices/{eui}/apply-spec — apply a spec to a device, replacing all config.
func applySpecHandler(app core.App) func(*core.RequestEvent) error {
	return func(e *core.RequestEvent) error {
		eui := normalizeEui(e.Request.PathValue("eui"))
		if eui == "" {
			return e.String(http.StatusBadRequest, "eui required")
		}

		var body struct {
			Spec DeviceSpec `json:"spec"`
		}
		if err := e.BindBody(&body); err != nil {
			return e.String(http.StatusBadRequest, "invalid body")
		}
		if body.Spec.Type != "airconfig" && body.Spec.Type != "codec" && body.Spec.Type != "" {
			return e.String(http.StatusBadRequest, "spec.type must be 'airconfig', 'codec', or empty")
		}

		dev, err := app.FindFirstRecordByFilter("devices", "device_eui = {:eui}", map[string]any{"eui": eui})
		if err != nil {
			return e.JSON(http.StatusNotFound, map[string]any{"error": "device not found"})
		}

		if err := materializeSpecToDevice(app, eui, &body.Spec); err != nil {
			return e.JSON(http.StatusInternalServerError, map[string]any{"error": err.Error()})
		}

		dev.Set("device_type", body.Spec.Type)
		configStatus := "n/a"
		if body.Spec.Type == "airconfig" {
			configStatus = "pending"
		}
		dev.Set("config_status", configStatus)
		if err := app.Save(dev); err != nil {
			return e.JSON(http.StatusInternalServerError, map[string]any{"error": err.Error()})
		}

		return e.JSON(http.StatusOK, map[string]any{
			"ok":            true,
			"device_type":   body.Spec.Type,
			"config_status": configStatus,
		})
	}
}

// POST /api/farmon/test-decode — test decode rules with sample payload (standalone, no template).
// Body: { "spec": { ... }, "fport": 2, "payload_hex": "..." }
func testDecodeHandler(app core.App) func(*core.RequestEvent) error {
	return func(e *core.RequestEvent) error {
		var body struct {
			Spec       DeviceSpec `json:"spec"`
			FPort      int        `json:"fport"`
			PayloadHex string     `json:"payload_hex"`
		}
		if err := e.BindBody(&body); err != nil {
			return e.String(http.StatusBadRequest, "invalid body")
		}

		fport := body.FPort
		if fport == 0 {
			return e.JSON(http.StatusBadRequest, map[string]any{"error": "fport required"})
		}

		// Find matching decode rule in the spec
		var rule *DecodeRule
		for i := range body.Spec.DecodeRules {
			if body.Spec.DecodeRules[i].FPort == fport {
				rule = &body.Spec.DecodeRules[i]
				break
			}
		}
		if rule == nil {
			return e.JSON(http.StatusBadRequest, map[string]any{"error": "no decode rule for given fport"})
		}

		payload, err := hex.DecodeString(body.PayloadHex)
		if err != nil {
			return e.JSON(http.StatusBadRequest, map[string]any{"error": "invalid hex: " + err.Error()})
		}

		result, err := DecodeWithRules(rule.Format, rule.Config, specFieldsToMapping(body.Spec.Fields), payload)
		if err != nil {
			return e.JSON(http.StatusBadRequest, map[string]any{"error": err.Error()})
		}

		return e.JSON(http.StatusOK, map[string]any{
			"format": rule.Format,
			"fport":  fport,
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

		deviceAC, err := loadDeviceAirConfig(app, eui)
		if err != nil {
			return e.JSON(http.StatusBadRequest, map[string]any{"error": "device has no airconfig"})
		}

		cfg := gwState.Config()
		if cfg == nil || !cfg.Valid() {
			return e.JSON(http.StatusServiceUnavailable, map[string]any{"error": "gateway not configured"})
		}

		if pushErr := pushAirConfig(app, cfg, eui, deviceAC); pushErr != nil {
			return e.JSON(http.StatusInternalServerError, map[string]any{"error": pushErr.Error()})
		}

		dev, err := app.FindFirstRecordByFilter("devices", "device_eui = {:eui}", nil)
		if err == nil {
			dev.Set("config_status", "pending")
			_ = app.Save(dev)
		}

		return e.JSON(http.StatusOK, map[string]any{"ok": true, "config_hash": computeConfigHash(deviceAC)})
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
			"target_field_idx": rec.GetFloat("target_field_idx"),
			"action_value":     rec.GetFloat("action_value"),
			"cooldown_seconds": rec.GetFloat("cooldown_seconds"),
			"priority":         rec.GetFloat("priority"),
			"action_dur_x10s":  rec.GetFloat("action_dur_x10s"),
		})

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

		wa := rec.GetBool("window_active")
		if rec.Get("window_active") == nil {
			wa = true
		}
		windowActive = append(windowActive, wa)
	}

	return ruleMaps, extras, windowActive
}

// POST /api/farmon/devices/{eui}/push-sensor-slot — configure a single sensor slot via AirConfig downlink.
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
			CalibOffset float64 `json:"calib_offset"`
			CalibSpan   float64 `json:"calib_span"`
			Param1Raw   *uint16 `json:"param1_raw"`
			Param2Raw   *uint16 `json:"param2_raw"`
		}
		if err := e.BindBody(&body); err != nil {
			return e.String(http.StatusBadRequest, "invalid body")
		}
		if body.Slot >= 8 {
			return e.String(http.StatusBadRequest, "slot must be 0-7")
		}

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

// POST /api/farmon/devices/{eui}/compile-expression — compile a compute expression to bytecode.
func compileExpressionHandler() func(*core.RequestEvent) error {
	return func(e *core.RequestEvent) error {
		var body struct {
			Expression string `json:"expression"`
		}
		if err := e.BindBody(&body); err != nil {
			return e.String(http.StatusBadRequest, "invalid body")
		}

		bytecode, err := CompileExpression(body.Expression)
		if err != nil {
			return e.JSON(http.StatusOK, map[string]any{
				"bytecode_hex":  "",
				"bytecode_size": 0,
				"errors":        []string{err.Error()},
			})
		}

		return e.JSON(http.StatusOK, map[string]any{
			"bytecode_hex":  hex.EncodeToString(bytecode),
			"bytecode_size": len(bytecode),
			"errors":        []string{},
		})
	}
}

// POST /api/farmon/validate-airconfig — validate an airconfig for pin conflicts, field overlaps, etc.
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

		ac := &AirConfig{
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
