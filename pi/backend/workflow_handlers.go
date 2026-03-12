package main

import (
	"encoding/json"
	"net/http"
	"strconv"

	"github.com/expr-lang/expr"
	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/core"
)

// listWorkflowsHandler returns all workflows, optionally filtered by device_eui (matches triggers or actions).
func listWorkflowsHandler(app core.App) func(*core.RequestEvent) error {
	return func(e *core.RequestEvent) error {
		filter := ""
		var params dbx.Params
		if eui := e.Request.URL.Query().Get("device_eui"); eui != "" {
			filter = "triggers ~ {:eui} || actions ~ {:eui}"
			params = dbx.Params{"eui": eui}
		}
		records, err := app.FindRecordsByFilter("workflows", filter, "priority", 200, 0, params)
		if err != nil {
			return e.JSON(http.StatusOK, []any{})
		}
		items := make([]map[string]any, 0, len(records))
		for _, rec := range records {
			items = append(items, workflowRecordToMap(rec))
		}
		return e.JSON(http.StatusOK, items)
	}
}

// createWorkflowHandler validates and creates a workflow.
func createWorkflowHandler(app core.App, engine *WorkflowEngine) func(*core.RequestEvent) error {
	return func(e *core.RequestEvent) error {
		var body map[string]any
		if err := e.BindBody(&body); err != nil {
			return e.String(http.StatusBadRequest, "invalid body")
		}

		// Validate triggers
		triggersRaw, _ := body["triggers"]
		triggers, err := parseTriggers(triggersRaw)
		if err != nil || len(triggers) == 0 {
			return e.JSON(http.StatusBadRequest, map[string]any{"ok": false, "error": "at least one trigger is required"})
		}

		// Validate condition expression if provided
		if condExpr, _ := body["condition_expr"].(string); condExpr != "" {
			if _, err := expr.Compile(condExpr, expr.AsBool(), expr.AllowUndefinedVariables()); err != nil {
				return e.JSON(http.StatusBadRequest, map[string]any{"ok": false, "error": "invalid expression: " + err.Error()})
			}
		}

		// Validate actions
		actionsRaw, _ := body["actions"]
		actions, err := parseActions(actionsRaw)
		if err != nil || len(actions) == 0 {
			return e.JSON(http.StatusBadRequest, map[string]any{"ok": false, "error": "at least one action is required"})
		}
		for _, a := range actions {
			if a.Type != "set_control" && a.Type != "send_command" {
				return e.JSON(http.StatusBadRequest, map[string]any{"ok": false, "error": "action type must be 'set_control' or 'send_command'"})
			}
		}
		if err := validateUniqueTargets(actions); err != nil {
			return e.JSON(http.StatusBadRequest, map[string]any{"ok": false, "error": err.Error()})
		}

		coll, err := app.FindCollectionByNameOrId("workflows")
		if err != nil {
			return e.JSON(http.StatusInternalServerError, map[string]any{"ok": false, "error": "workflows collection not found"})
		}
		rec := core.NewRecord(coll)
		setWorkflowFields(rec, body)
		if err := app.Save(rec); err != nil {
			return e.JSON(http.StatusInternalServerError, map[string]any{"ok": false, "error": err.Error()})
		}
		return e.JSON(http.StatusOK, workflowRecordToMap(rec))
	}
}

// updateWorkflowHandler updates an existing workflow.
func updateWorkflowHandler(app core.App, engine *WorkflowEngine) func(*core.RequestEvent) error {
	return func(e *core.RequestEvent) error {
		id := e.Request.PathValue("id")
		if id == "" {
			return e.String(http.StatusBadRequest, "id required")
		}
		rec, err := app.FindRecordById("workflows", id)
		if err != nil {
			return e.JSON(http.StatusNotFound, map[string]any{"ok": false, "error": "workflow not found"})
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

		// Validate actions if changed
		if actionsRaw, ok := body["actions"]; ok {
			actions, err := parseActions(actionsRaw)
			if err != nil || len(actions) == 0 {
				return e.JSON(http.StatusBadRequest, map[string]any{"ok": false, "error": "at least one action is required"})
			}
			if err := validateUniqueTargets(actions); err != nil {
				return e.JSON(http.StatusBadRequest, map[string]any{"ok": false, "error": err.Error()})
			}
		}

		setWorkflowFields(rec, body)
		if err := app.Save(rec); err != nil {
			return e.JSON(http.StatusInternalServerError, map[string]any{"ok": false, "error": err.Error()})
		}
		return e.JSON(http.StatusOK, workflowRecordToMap(rec))
	}
}

// deleteWorkflowHandler deletes a workflow by ID.
func deleteWorkflowHandler(app core.App, engine *WorkflowEngine) func(*core.RequestEvent) error {
	return func(e *core.RequestEvent) error {
		id := e.Request.PathValue("id")
		if id == "" {
			return e.String(http.StatusBadRequest, "id required")
		}
		rec, err := app.FindRecordById("workflows", id)
		if err != nil {
			return e.JSON(http.StatusNotFound, map[string]any{"ok": false, "error": "not found"})
		}
		if err := app.Delete(rec); err != nil {
			return e.JSON(http.StatusInternalServerError, map[string]any{"ok": false, "error": err.Error()})
		}
		return e.JSON(http.StatusOK, map[string]any{"ok": true})
	}
}

// testWorkflowHandler dry-runs a workflow with mock trigger data.
func testWorkflowHandler(app core.App, engine *WorkflowEngine) func(*core.RequestEvent) error {
	return func(e *core.RequestEvent) error {
		id := e.Request.PathValue("id")
		if id == "" {
			return e.String(http.StatusBadRequest, "id required")
		}
		var body struct {
			TriggerIndex  int            `json:"trigger_index"`
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

		result := engine.EvaluateDryRun(id, body.TriggerIndex, ctx)
		return e.JSON(http.StatusOK, result)
	}
}

// listWorkflowLogHandler returns recent workflow log entries.
func listWorkflowLogHandler(app core.App) func(*core.RequestEvent) error {
	return func(e *core.RequestEvent) error {
		limit := 50
		if s := e.Request.URL.Query().Get("limit"); s != "" {
			if n, err := strconv.Atoi(s); err == nil && n > 0 && n <= 200 {
				limit = n
			}
		}
		filter := ""
		var params dbx.Params
		if wid := e.Request.URL.Query().Get("workflow_id"); wid != "" {
			filter = "workflow_id = {:id}"
			params = dbx.Params{"id": wid}
		}
		records, err := app.FindRecordsByFilter("workflow_log", filter, "-ts", limit, 0, params)
		if err != nil {
			return e.JSON(http.StatusOK, []any{})
		}
		items := make([]map[string]any, 0, len(records))
		for _, rec := range records {
			items = append(items, map[string]any{
				"id":                rec.Id,
				"workflow_id":       strOrDefault(rec.Get("workflow_id"), ""),
				"workflow_name":     strOrDefault(rec.Get("workflow_name"), ""),
				"trigger_device":    strOrDefault(rec.Get("trigger_device"), ""),
				"trigger_type":      strOrDefault(rec.Get("trigger_type"), ""),
				"trigger_index":     intFromRecord(rec, "trigger_index"),
				"condition_result":  rec.GetBool("condition_result"),
				"actions_completed": intFromRecord(rec, "actions_completed"),
				"status":            strOrDefault(rec.Get("status"), ""),
				"error_message":     strOrDefault(rec.Get("error_message"), ""),
				"ts":                strOrDefault(rec.Get("ts"), ""),
			})
		}
		return e.JSON(http.StatusOK, items)
	}
}

// helpers

func workflowRecordToMap(rec *core.Record) map[string]any {
	return map[string]any{
		"id":               rec.Id,
		"name":             strOrDefault(rec.Get("name"), ""),
		"description":      strOrDefault(rec.Get("description"), ""),
		"enabled":          rec.GetBool("enabled"),
		"priority":         intFromRecord(rec, "priority"),
		"cooldown_seconds": intFromRecord(rec, "cooldown_seconds"),
		"triggers":         parseJSONArray(rec.Get("triggers")),
		"condition_expr":   strOrDefault(rec.Get("condition_expr"), ""),
		"actions":          parseJSONArray(rec.Get("actions")),
	}
}

func setWorkflowFields(rec *core.Record, body map[string]any) {
	for _, key := range []string{"name", "description", "condition_expr"} {
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
	// JSON array fields
	for _, key := range []string{"triggers", "actions"} {
		if v, ok := body[key]; ok {
			switch arr := v.(type) {
			case []any:
				b, _ := json.Marshal(arr)
				rec.Set(key, string(b))
			case string:
				rec.Set(key, arr)
			default:
				b, _ := json.Marshal(v)
				rec.Set(key, string(b))
			}
		}
	}
}

func parseJSONArray(v any) []any {
	switch val := v.(type) {
	case string:
		var arr []any
		if json.Unmarshal([]byte(val), &arr) == nil {
			return arr
		}
	case []any:
		return val
	}
	return []any{}
}
