package main

import (
	"encoding/json"
	"net/http"
	"strconv"

	"github.com/expr-lang/expr"
	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/core"
)

// listAutomationsHandler returns all automations, optionally filtered by trigger_device.
func listAutomationsHandler(app core.App) func(*core.RequestEvent) error {
	return func(e *core.RequestEvent) error {
		filter := ""
		var params dbx.Params
		if eui := e.Request.URL.Query().Get("device_eui"); eui != "" {
			filter = "trigger_device = {:eui} || trigger_device = ''"
			params = dbx.Params{"eui": eui}
		}
		records, err := app.FindRecordsByFilter("automations", filter, "priority", 200, 0, params)
		if err != nil {
			return e.JSON(http.StatusOK, []any{})
		}
		items := make([]map[string]any, 0, len(records))
		for _, rec := range records {
			items = append(items, automationRecordToMap(rec))
		}
		return e.JSON(http.StatusOK, items)
	}
}

// createAutomationHandler validates and creates an automation.
func createAutomationHandler(app core.App, engine *AutomationEngine) func(*core.RequestEvent) error {
	return func(e *core.RequestEvent) error {
		var body map[string]any
		if err := e.BindBody(&body); err != nil {
			return e.String(http.StatusBadRequest, "invalid body")
		}

		// Validate condition expression compiles
		condExpr, _ := body["condition_expr"].(string)
		if condExpr == "" {
			return e.JSON(http.StatusBadRequest, map[string]any{"ok": false, "error": "condition_expr required"})
		}
		if _, err := expr.Compile(condExpr, expr.AsBool(), expr.AllowUndefinedVariables()); err != nil {
			return e.JSON(http.StatusBadRequest, map[string]any{"ok": false, "error": "invalid expression: " + err.Error()})
		}

		// Validate action_type
		actionType, _ := body["action_type"].(string)
		if actionType != "setControl" && actionType != "sendCommand" {
			return e.JSON(http.StatusBadRequest, map[string]any{"ok": false, "error": "action_type must be 'setControl' or 'sendCommand'"})
		}

		coll, err := app.FindCollectionByNameOrId("automations")
		if err != nil {
			return e.JSON(http.StatusInternalServerError, map[string]any{"ok": false, "error": "automations collection not found"})
		}
		rec := core.NewRecord(coll)
		setAutomationFields(rec, body)
		if err := app.Save(rec); err != nil {
			return e.JSON(http.StatusInternalServerError, map[string]any{"ok": false, "error": err.Error()})
		}
		// engine.LoadRules() is triggered by PocketBase AfterCreateSuccess hook
		return e.JSON(http.StatusOK, automationRecordToMap(rec))
	}
}

// updateAutomationHandler updates an existing automation.
func updateAutomationHandler(app core.App, engine *AutomationEngine) func(*core.RequestEvent) error {
	return func(e *core.RequestEvent) error {
		id := e.Request.PathValue("id")
		if id == "" {
			return e.String(http.StatusBadRequest, "id required")
		}
		rec, err := app.FindRecordById("automations", id)
		if err != nil {
			return e.JSON(http.StatusNotFound, map[string]any{"ok": false, "error": "automation not found"})
		}
		var body map[string]any
		if err := e.BindBody(&body); err != nil {
			return e.String(http.StatusBadRequest, "invalid body")
		}

		// Re-validate expression if changed
		if condExpr, ok := body["condition_expr"].(string); ok && condExpr != "" {
			if _, err := expr.Compile(condExpr, expr.AsBool(), expr.AllowUndefinedVariables()); err != nil {
				return e.JSON(http.StatusBadRequest, map[string]any{"ok": false, "error": "invalid expression: " + err.Error()})
			}
		}

		setAutomationFields(rec, body)
		if err := app.Save(rec); err != nil {
			return e.JSON(http.StatusInternalServerError, map[string]any{"ok": false, "error": err.Error()})
		}
		return e.JSON(http.StatusOK, automationRecordToMap(rec))
	}
}

// deleteAutomationHandler deletes an automation by ID.
func deleteAutomationHandler(app core.App, engine *AutomationEngine) func(*core.RequestEvent) error {
	return func(e *core.RequestEvent) error {
		id := e.Request.PathValue("id")
		if id == "" {
			return e.String(http.StatusBadRequest, "id required")
		}
		rec, err := app.FindRecordById("automations", id)
		if err != nil {
			return e.JSON(http.StatusNotFound, map[string]any{"ok": false, "error": "not found"})
		}
		if err := app.Delete(rec); err != nil {
			return e.JSON(http.StatusInternalServerError, map[string]any{"ok": false, "error": err.Error()})
		}
		return e.JSON(http.StatusOK, map[string]any{"ok": true})
	}
}

// testAutomationHandler dry-runs an automation with mock trigger data.
func testAutomationHandler(app core.App, engine *AutomationEngine) func(*core.RequestEvent) error {
	return func(e *core.RequestEvent) error {
		id := e.Request.PathValue("id")
		if id == "" {
			return e.String(http.StatusBadRequest, "id required")
		}
		var body struct {
			MockTelemetry map[string]any `json:"mock_telemetry"`
			MockDeviceEUI string         `json:"mock_device_eui"`
			MockControl   string         `json:"mock_control"`
			MockNewState  string         `json:"mock_new_state"`
			MockOldState  string         `json:"mock_old_state"`
		}
		if err := e.BindBody(&body); err != nil {
			return e.String(http.StatusBadRequest, "invalid body")
		}

		ctx := TriggerContext{
			Type:       TriggerTelemetry,
			DeviceEUI:  body.MockDeviceEUI,
			DeviceName: body.MockDeviceEUI,
			Telemetry:  body.MockTelemetry,
		}
		if body.MockControl != "" {
			ctx.Type = TriggerStateChange
			ctx.ControlKey = body.MockControl
			ctx.NewState = body.MockNewState
			ctx.OldState = body.MockOldState
		}

		result := engine.EvaluateDryRun(id, ctx)
		return e.JSON(http.StatusOK, result)
	}
}

// listAutomationLogHandler returns recent automation log entries.
func listAutomationLogHandler(app core.App) func(*core.RequestEvent) error {
	return func(e *core.RequestEvent) error {
		limit := 50
		if s := e.Request.URL.Query().Get("limit"); s != "" {
			if n, err := strconv.Atoi(s); err == nil && n > 0 && n <= 200 {
				limit = n
			}
		}
		filter := ""
		var params dbx.Params
		if aid := e.Request.URL.Query().Get("automation_id"); aid != "" {
			filter = "automation_id = {:id}"
			params = dbx.Params{"id": aid}
		}
		records, err := app.FindRecordsByFilter("automation_log", filter, "-ts", limit, 0, params)
		if err != nil {
			return e.JSON(http.StatusOK, []any{})
		}
		items := make([]map[string]any, 0, len(records))
		for _, rec := range records {
			items = append(items, map[string]any{
				"id":               rec.Id,
				"automation_id":    strOrDefault(rec.Get("automation_id"), ""),
				"automation_name":  strOrDefault(rec.Get("automation_name"), ""),
				"trigger_device":   strOrDefault(rec.Get("trigger_device"), ""),
				"trigger_type":     strOrDefault(rec.Get("trigger_type"), ""),
				"condition_result": rec.GetBool("condition_result"),
				"status":           strOrDefault(rec.Get("status"), ""),
				"error_message":    strOrDefault(rec.Get("error_message"), ""),
				"ts":               strOrDefault(rec.Get("ts"), ""),
			})
		}
		return e.JSON(http.StatusOK, items)
	}
}

// helpers

func automationRecordToMap(rec *core.Record) map[string]any {
	return map[string]any{
		"id":               rec.Id,
		"name":             strOrDefault(rec.Get("name"), ""),
		"enabled":          rec.GetBool("enabled"),
		"trigger_type":     strOrDefault(rec.Get("trigger_type"), ""),
		"trigger_device":   strOrDefault(rec.Get("trigger_device"), ""),
		"condition_expr":   strOrDefault(rec.Get("condition_expr"), ""),
		"action_type":      strOrDefault(rec.Get("action_type"), ""),
		"action_config":    parseJSONField(rec.Get("action_config")),
		"cooldown_seconds": intFromRecord(rec, "cooldown_seconds"),
		"priority":         intFromRecord(rec, "priority"),
		"description":      strOrDefault(rec.Get("description"), ""),
	}
}

func setAutomationFields(rec *core.Record, body map[string]any) {
	for _, key := range []string{"name", "trigger_type", "trigger_device", "condition_expr", "action_type", "description"} {
		if v, ok := body[key]; ok {
			rec.Set(key, v)
		}
	}
	if v, ok := body["enabled"]; ok {
		rec.Set("enabled", v)
	}
	if v, ok := body["cooldown_seconds"]; ok {
		rec.Set("cooldown_seconds", v)
	}
	if v, ok := body["priority"]; ok {
		rec.Set("priority", v)
	}
	if v, ok := body["action_config"]; ok {
		switch ac := v.(type) {
		case map[string]any:
			b, _ := json.Marshal(ac)
			rec.Set("action_config", string(b))
		default:
			rec.Set("action_config", v)
		}
	}
}
