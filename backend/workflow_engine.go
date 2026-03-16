package main

import (
	"encoding/json"
	"fmt"
	"log"
	"sort"
	"sync"
	"time"

	"github.com/expr-lang/expr"
	"github.com/expr-lang/expr/vm"
	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/core"
)

// workflowEngine is the package-level workflow engine instance, set in main().
var workflowEngine *WorkflowEngine

// TriggerType enumerates what can fire a workflow.
type TriggerType string

const (
	TriggerTelemetry   TriggerType = "telemetry"
	TriggerStateChange TriggerType = "state_change"
)

// TriggerContext carries all data from the triggering event to the engine.
type TriggerContext struct {
	Type       TriggerType
	DeviceEUI  string
	DeviceName string
	Telemetry  map[string]any // fPort 2: decoded field values
	ControlKey string         // fPort 3
	OldState   string
	NewState   string
	Source     string // "RULE", "MANUAL", "DOWNLINK", "BOOT"
}

// WorkflowTrigger is a single trigger definition within a workflow.
type WorkflowTrigger struct {
	Type   TriggerType            `json:"type"`
	Filter map[string]string      `json:"filter,omitempty"` // device_eui, field, control_key
}

// WorkflowAction is a single action in the workflow pipeline.
type WorkflowAction struct {
	Type      string `json:"type"`       // "set_control" | "send_command"
	TargetEUI string `json:"target_eui"`
	Control   string `json:"control,omitempty"`
	State     string `json:"state,omitempty"`
	Duration  int    `json:"duration,omitempty"`
	Command   string `json:"command,omitempty"`
	Value     *uint32 `json:"value,omitempty"`
}

// compiledWorkflow is a cached, compiled workflow.
type compiledWorkflow struct {
	ID            string
	Name          string
	Triggers      []WorkflowTrigger
	Program       *vm.Program
	ConditionExpr string
	Actions       []WorkflowAction
	CooldownSec   int
	Priority      int
}

// WorkflowEngine evaluates server workflows on uplink events.
type WorkflowEngine struct {
	mu        sync.RWMutex
	workflows []compiledWorkflow
	cooldowns map[string]time.Time // workflow ID → last fired
	app       core.App
	gwState   *GatewayState
}

// NewWorkflowEngine creates a new engine.
func NewWorkflowEngine(app core.App, gwState *GatewayState) *WorkflowEngine {
	return &WorkflowEngine{
		app:       app,
		gwState:   gwState,
		cooldowns: make(map[string]time.Time),
	}
}

// LoadWorkflows queries the workflows collection and compiles all enabled workflows.
func (e *WorkflowEngine) LoadWorkflows() error {
	records, err := e.app.FindRecordsByFilter("workflows", "enabled = true", "priority", 500, 0, nil)
	if err != nil {
		log.Printf("workflow: load: %v", err)
		e.mu.Lock()
		e.workflows = nil
		e.mu.Unlock()
		return err
	}

	workflows := make([]compiledWorkflow, 0, len(records))
	for _, rec := range records {
		// Parse triggers
		triggers, err := parseTriggers(rec.Get("triggers"))
		if err != nil || len(triggers) == 0 {
			log.Printf("workflow: skip id=%s: invalid triggers: %v", rec.Id, err)
			continue
		}

		// Parse condition expression (optional — empty means always pass)
		condExpr, _ := rec.Get("condition_expr").(string)
		var program *vm.Program
		if condExpr != "" {
			program, err = expr.Compile(condExpr, expr.AsBool(), expr.AllowUndefinedVariables())
			if err != nil {
				log.Printf("workflow: compile error id=%s expr=%q: %v", rec.Id, condExpr, err)
				continue
			}
		}

		// Parse actions
		actions, err := parseActions(rec.Get("actions"))
		if err != nil || len(actions) == 0 {
			log.Printf("workflow: skip id=%s: invalid actions: %v", rec.Id, err)
			continue
		}

		// Validate: max one action per target_eui
		if err := validateUniqueTargets(actions); err != nil {
			log.Printf("workflow: skip id=%s: %v", rec.Id, err)
			continue
		}

		workflows = append(workflows, compiledWorkflow{
			ID:            rec.Id,
			Name:          strOrDefault(rec.Get("name"), ""),
			Triggers:      triggers,
			Program:       program,
			ConditionExpr: condExpr,
			Actions:       actions,
			CooldownSec:   intFromRecord(rec, "cooldown_seconds"),
			Priority:      intFromRecord(rec, "priority"),
		})
	}

	sort.Slice(workflows, func(i, j int) bool {
		return workflows[i].Priority < workflows[j].Priority
	})

	e.mu.Lock()
	e.workflows = workflows
	e.mu.Unlock()
	log.Printf("workflow: loaded %d workflows", len(workflows))
	return nil
}

// Evaluate is called from the pipeline on each trigger event.
func (e *WorkflowEngine) Evaluate(ctx TriggerContext) {
	e.mu.RLock()
	workflows := e.workflows
	e.mu.RUnlock()

	if len(workflows) == 0 {
		return
	}

	for _, wf := range workflows {
		triggerIdx := matchTrigger(wf.Triggers, ctx)
		if triggerIdx < 0 {
			continue
		}

		env := e.buildExprEnv(ctx)

		// Evaluate condition (nil program = always pass)
		condResult := true
		if wf.Program != nil {
			result, err := expr.Run(wf.Program, env)
			if err != nil {
				e.logWorkflow(wf, ctx, triggerIdx, false, 0, "error", err.Error(), env)
				continue
			}
			ok, isOk := result.(bool)
			if !isOk {
				e.logWorkflow(wf, ctx, triggerIdx, false, 0, "error", "condition did not return bool", env)
				continue
			}
			condResult = ok
		}

		if !condResult {
			continue
		}

		if !e.checkCooldown(wf.ID, wf.CooldownSec) {
			e.logWorkflow(wf, ctx, triggerIdx, true, 0, "skipped_cooldown", "", env)
			continue
		}

		// Execute actions sequentially
		actionsCompleted := 0
		var actionErr error
		for _, action := range wf.Actions {
			if err := e.executeAction(action); err != nil {
				actionErr = err
				break
			}
			actionsCompleted++
		}

		e.recordCooldown(wf.ID)

		if actionErr != nil {
			e.logWorkflow(wf, ctx, triggerIdx, true, actionsCompleted, "error", actionErr.Error(), env)
		} else {
			e.logWorkflow(wf, ctx, triggerIdx, true, actionsCompleted, "fired", "", env)
			log.Printf("workflow: fired %q device=%s actions=%d", wf.Name, ctx.DeviceEUI, actionsCompleted)
		}
	}
}

// matchTrigger returns the index of the first matching trigger, or -1.
func matchTrigger(triggers []WorkflowTrigger, ctx TriggerContext) int {
	for i, t := range triggers {
		if t.Type != ctx.Type {
			continue
		}
		// Check filter constraints
		if euiFilter, ok := t.Filter["device_eui"]; ok && euiFilter != "" && euiFilter != ctx.DeviceEUI {
			continue
		}
		if fieldFilter, ok := t.Filter["field"]; ok && fieldFilter != "" {
			if _, exists := ctx.Telemetry[fieldFilter]; !exists && ctx.Type == TriggerTelemetry {
				continue
			}
		}
		if ctrlFilter, ok := t.Filter["control_key"]; ok && ctrlFilter != "" && ctrlFilter != ctx.ControlKey {
			continue
		}
		return i
	}
	return -1
}

// DryRunResult holds the result of a dry-run evaluation.
type DryRunResult struct {
	WorkflowID      string         `json:"workflow_id"`
	WorkflowName    string         `json:"workflow_name"`
	TriggerIndex    int            `json:"trigger_index"`
	ConditionResult bool           `json:"condition_result"`
	WouldFire       bool           `json:"would_fire"`
	CooldownActive  bool           `json:"cooldown_active"`
	Env             map[string]any `json:"env"`
	Error           string         `json:"error,omitempty"`
}

// EvaluateDryRun evaluates without executing actions.
func (e *WorkflowEngine) EvaluateDryRun(workflowID string, triggerIdx int, ctx TriggerContext) DryRunResult {
	e.mu.RLock()
	var wf *compiledWorkflow
	for i := range e.workflows {
		if e.workflows[i].ID == workflowID {
			wf = &e.workflows[i]
			break
		}
	}
	e.mu.RUnlock()

	// If not in compiled cache, try to compile it fresh from DB
	if wf == nil {
		rec, err := e.app.FindRecordById("workflows", workflowID)
		if err != nil {
			return DryRunResult{WorkflowID: workflowID, Error: "workflow not found"}
		}
		triggers, _ := parseTriggers(rec.Get("triggers"))
		condExpr, _ := rec.Get("condition_expr").(string)
		var program *vm.Program
		if condExpr != "" {
			program, err = expr.Compile(condExpr, expr.AsBool(), expr.AllowUndefinedVariables())
			if err != nil {
				return DryRunResult{WorkflowID: workflowID, Error: "compile error: " + err.Error()}
			}
		}
		wf = &compiledWorkflow{
			ID:            workflowID,
			Name:          strOrDefault(rec.Get("name"), ""),
			Triggers:      triggers,
			Program:       program,
			ConditionExpr: condExpr,
			CooldownSec:   intFromRecord(rec, "cooldown_seconds"),
		}
	}

	// Use specified trigger index to build context
	if triggerIdx >= 0 && triggerIdx < len(wf.Triggers) {
		// Apply trigger's filter to the context if needed
		t := wf.Triggers[triggerIdx]
		ctx.Type = t.Type
		if euiFilter, ok := t.Filter["device_eui"]; ok && euiFilter != "" && ctx.DeviceEUI == "" {
			ctx.DeviceEUI = euiFilter
		}
	}

	env := e.buildExprEnv(ctx)

	condResult := true
	if wf.Program != nil {
		result, err := expr.Run(wf.Program, env)
		if err != nil {
			return DryRunResult{WorkflowID: workflowID, WorkflowName: wf.Name, TriggerIndex: triggerIdx, Env: sanitizeEnv(env), Error: err.Error()}
		}
		condResult, _ = result.(bool)
	}

	cooldownActive := !e.checkCooldown(wf.ID, wf.CooldownSec)
	return DryRunResult{
		WorkflowID:      workflowID,
		WorkflowName:    wf.Name,
		TriggerIndex:    triggerIdx,
		ConditionResult: condResult,
		WouldFire:       condResult && !cooldownActive,
		CooldownActive:  cooldownActive,
		Env:             sanitizeEnv(env),
	}
}

func (e *WorkflowEngine) buildExprEnv(ctx TriggerContext) map[string]any {
	env := map[string]any{
		"device_eui":  ctx.DeviceEUI,
		"device_name": ctx.DeviceName,
		"now":         time.Now(),
		"hour":        time.Now().Hour(),
	}
	for k, v := range ctx.Telemetry {
		env[k] = v
	}
	if ctx.Type == TriggerStateChange {
		env["control_key"] = ctx.ControlKey
		env["old_state"] = ctx.OldState
		env["new_state"] = ctx.NewState
		env["source"] = ctx.Source
	}
	env["device_state"] = func(eui, controlKey string) string {
		rec, err := e.app.FindFirstRecordByFilter("device_controls",
			"device_eui = {:eui} && control_key = {:key}",
			dbx.Params{"eui": eui, "key": controlKey})
		if err != nil {
			return ""
		}
		s, _ := rec.Get("current_state").(string)
		return s
	}
	env["device_field"] = func(eui, fieldKey string) float64 {
		recs, err := e.app.FindRecordsByFilter("telemetry",
			"device_eui = {:eui}", "-ts", 1, 0,
			dbx.Params{"eui": eui})
		if err != nil || len(recs) == 0 {
			return 0
		}
		dataRaw := recs[0].Get("data")
		dataStr, ok := dataRaw.(string)
		if !ok {
			return 0
		}
		var data map[string]any
		if json.Unmarshal([]byte(dataStr), &data) != nil {
			return 0
		}
		return getFloat64(data[fieldKey])
	}
	return env
}

func (e *WorkflowEngine) checkCooldown(workflowID string, cooldownSec int) bool {
	if cooldownSec <= 0 {
		return true
	}
	e.mu.RLock()
	lastFired, ok := e.cooldowns[workflowID]
	e.mu.RUnlock()
	if !ok {
		return true
	}
	return time.Since(lastFired) >= time.Duration(cooldownSec)*time.Second
}

func (e *WorkflowEngine) recordCooldown(workflowID string) {
	e.mu.Lock()
	e.cooldowns[workflowID] = time.Now()
	e.mu.Unlock()
}

func (e *WorkflowEngine) executeAction(action WorkflowAction) error {
	cfg := e.gwState.Config()
	if cfg == nil || !cfg.Valid() {
		return nil
	}

	switch action.Type {
	case "set_control":
		if action.TargetEUI == "" || action.Control == "" {
			return nil
		}
		return ExecuteSetControl(e.app, cfg, SetControlParams{
			DeviceEUI: action.TargetEUI, Control: action.Control, State: action.State,
			Duration: action.Duration, InitiatedBy: "workflow",
		})
	case "send_command":
		if action.TargetEUI == "" || action.Command == "" {
			return nil
		}
		return ExecuteSendCommand(e.app, cfg, SendCommandParams{
			DeviceEUI: action.TargetEUI, Command: action.Command, Value: action.Value, InitiatedBy: "workflow",
		})
	default:
		return nil
	}
}

func (e *WorkflowEngine) logWorkflow(wf compiledWorkflow, ctx TriggerContext, triggerIdx int, condResult bool, actionsCompleted int, status, errMsg string, env map[string]any) {
	coll, err := e.app.FindCollectionByNameOrId("workflow_log")
	if err != nil {
		return
	}
	rec := core.NewRecord(coll)
	rec.Set("workflow_id", wf.ID)
	rec.Set("workflow_name", wf.Name)
	rec.Set("trigger_device", ctx.DeviceEUI)
	rec.Set("trigger_type", string(ctx.Type))
	rec.Set("trigger_index", triggerIdx)
	rec.Set("condition_result", condResult)
	rec.Set("actions_completed", actionsCompleted)
	rec.Set("status", status)
	if errMsg != "" {
		rec.Set("error_message", errMsg)
	}
	snapshot := sanitizeEnv(env)
	if b, err := json.Marshal(snapshot); err == nil {
		rec.Set("context_snapshot", string(b))
	}
	rec.Set("ts", time.Now().Format(time.RFC3339))
	_ = e.app.Save(rec)
}

// sanitizeEnv removes non-serializable values (functions) from the env map.
func sanitizeEnv(env map[string]any) map[string]any {
	out := make(map[string]any, len(env))
	for k, v := range env {
		switch v.(type) {
		case func(string, string) string, func(string, string) float64:
			continue
		default:
			out[k] = v
		}
	}
	return out
}

// parseTriggers parses the triggers JSON field into a slice.
func parseTriggers(v any) ([]WorkflowTrigger, error) {
	var raw []byte
	switch val := v.(type) {
	case string:
		raw = []byte(val)
	case []byte:
		raw = val
	default:
		b, err := json.Marshal(v)
		if err != nil {
			return nil, err
		}
		raw = b
	}
	var triggers []WorkflowTrigger
	if err := json.Unmarshal(raw, &triggers); err != nil {
		return nil, err
	}
	return triggers, nil
}

// parseActions parses the actions JSON field into a slice.
func parseActions(v any) ([]WorkflowAction, error) {
	var raw []byte
	switch val := v.(type) {
	case string:
		raw = []byte(val)
	case []byte:
		raw = val
	default:
		b, err := json.Marshal(v)
		if err != nil {
			return nil, err
		}
		raw = b
	}
	var actions []WorkflowAction
	if err := json.Unmarshal(raw, &actions); err != nil {
		return nil, err
	}
	return actions, nil
}

// validateUniqueTargets ensures no two downlink actions target the same device.
func validateUniqueTargets(actions []WorkflowAction) error {
	seen := make(map[string]bool)
	for _, a := range actions {
		if a.TargetEUI == "" {
			continue
		}
		if seen[a.TargetEUI] {
			return fmt.Errorf("multiple actions target the same device %s (only one downlink per device per uplink cycle)", a.TargetEUI)
		}
		seen[a.TargetEUI] = true
	}
	return nil
}

// Helpers

func parseJSONField(v any) map[string]any {
	switch val := v.(type) {
	case string:
		var m map[string]any
		if json.Unmarshal([]byte(val), &m) == nil {
			return m
		}
	case map[string]any:
		return val
	}
	return map[string]any{}
}

func intFromRecord(rec *core.Record, field string) int {
	v := rec.Get(field)
	switch n := v.(type) {
	case float64:
		return int(n)
	case int:
		return n
	case int64:
		return int(n)
	}
	return 0
}

func strOrDefault(v any, def string) string {
	if s, ok := v.(string); ok && s != "" {
		return s
	}
	return def
}
