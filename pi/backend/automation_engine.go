package main

import (
	"encoding/json"
	"log"
	"sort"
	"sync"
	"time"

	"github.com/expr-lang/expr"
	"github.com/expr-lang/expr/vm"
	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/core"
)

// autoEngine is the package-level automation engine instance, set in main().
var autoEngine *AutomationEngine

// TriggerType enumerates what can fire an automation.
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

// compiledRule is a cached, compiled automation rule.
type compiledRule struct {
	ID            string
	Name          string
	TriggerType   TriggerType
	TriggerDevice string // empty = any device
	Program       *vm.Program
	ConditionExpr string
	ActionType    string // "setControl" | "sendCommand"
	ActionConfig  map[string]any
	CooldownSec   int
	Priority      int
}

// AutomationEngine evaluates server automations on uplink events.
type AutomationEngine struct {
	mu        sync.RWMutex
	rules     []compiledRule
	cooldowns map[string]time.Time // rule ID → last fired
	app       core.App
	gwState   *GatewayState
}

// NewAutomationEngine creates a new engine.
func NewAutomationEngine(app core.App, gwState *GatewayState) *AutomationEngine {
	return &AutomationEngine{
		app:       app,
		gwState:   gwState,
		cooldowns: make(map[string]time.Time),
	}
}

// LoadRules queries the automations collection and compiles all enabled rules.
func (e *AutomationEngine) LoadRules() error {
	records, err := e.app.FindRecordsByFilter("automations", "enabled = true", "priority", 500, 0, nil)
	if err != nil {
		// Collection may not exist yet (migration not run)
		log.Printf("automation: load rules: %v", err)
		e.mu.Lock()
		e.rules = nil
		e.mu.Unlock()
		return err
	}

	rules := make([]compiledRule, 0, len(records))
	for _, rec := range records {
		condExpr, _ := rec.Get("condition_expr").(string)
		if condExpr == "" {
			continue
		}

		// Compile with a permissive env so arbitrary telemetry keys are allowed
		program, err := expr.Compile(condExpr, expr.AsBool(), expr.AllowUndefinedVariables())
		if err != nil {
			log.Printf("automation: compile error rule=%s expr=%q: %v", rec.Id, condExpr, err)
			continue
		}

		actionConfig := parseJSONField(rec.Get("action_config"))
		cooldown := intFromRecord(rec, "cooldown_seconds")
		priority := intFromRecord(rec, "priority")

		rules = append(rules, compiledRule{
			ID:            rec.Id,
			Name:          strOrDefault(rec.Get("name"), ""),
			TriggerType:   TriggerType(strOrDefault(rec.Get("trigger_type"), "telemetry")),
			TriggerDevice: strOrDefault(rec.Get("trigger_device"), ""),
			Program:       program,
			ConditionExpr: condExpr,
			ActionType:    strOrDefault(rec.Get("action_type"), ""),
			ActionConfig:  actionConfig,
			CooldownSec:   cooldown,
			Priority:      priority,
		})
	}

	sort.Slice(rules, func(i, j int) bool {
		return rules[i].Priority < rules[j].Priority
	})

	e.mu.Lock()
	e.rules = rules
	e.mu.Unlock()
	log.Printf("automation: loaded %d rules", len(rules))
	return nil
}

// Evaluate is called from the pipeline on each trigger event.
func (e *AutomationEngine) Evaluate(ctx TriggerContext) {
	e.mu.RLock()
	rules := e.rules
	e.mu.RUnlock()

	if len(rules) == 0 {
		return
	}

	for _, rule := range rules {
		if rule.TriggerType != ctx.Type {
			continue
		}
		if rule.TriggerDevice != "" && rule.TriggerDevice != ctx.DeviceEUI {
			continue
		}

		env := e.buildExprEnv(ctx)
		result, err := expr.Run(rule.Program, env)
		if err != nil {
			e.logAutomation(rule, ctx, false, "error", err.Error(), env)
			continue
		}

		condResult, ok := result.(bool)
		if !ok {
			e.logAutomation(rule, ctx, false, "error", "condition did not return bool", env)
			continue
		}

		if !condResult {
			// Don't log condition_false for every telemetry event — too noisy
			continue
		}

		// Check cooldown
		if !e.checkCooldown(rule.ID, rule.CooldownSec) {
			e.logAutomation(rule, ctx, true, "skipped_cooldown", "", env)
			continue
		}

		// Execute action
		if err := e.executeAction(rule); err != nil {
			e.logAutomation(rule, ctx, true, "error", err.Error(), env)
			continue
		}

		e.recordCooldown(rule.ID)
		e.logAutomation(rule, ctx, true, "fired", "", env)
		log.Printf("automation: fired rule=%q device=%s action=%s", rule.Name, ctx.DeviceEUI, rule.ActionType)
	}
}

// DryRunResult holds the result of a dry-run evaluation.
type DryRunResult struct {
	RuleID          string         `json:"rule_id"`
	RuleName        string         `json:"rule_name"`
	ConditionResult bool           `json:"condition_result"`
	WouldFire       bool           `json:"would_fire"`
	CooldownActive  bool           `json:"cooldown_active"`
	Env             map[string]any `json:"env"`
	Error           string         `json:"error,omitempty"`
}

// EvaluateDryRun evaluates without executing actions.
func (e *AutomationEngine) EvaluateDryRun(ruleID string, ctx TriggerContext) DryRunResult {
	e.mu.RLock()
	var rule *compiledRule
	for i := range e.rules {
		if e.rules[i].ID == ruleID {
			rule = &e.rules[i]
			break
		}
	}
	e.mu.RUnlock()

	// If rule not in compiled cache, try to compile it fresh from DB
	if rule == nil {
		rec, err := e.app.FindRecordById("automations", ruleID)
		if err != nil {
			return DryRunResult{RuleID: ruleID, Error: "rule not found"}
		}
		condExpr, _ := rec.Get("condition_expr").(string)
		program, err := expr.Compile(condExpr, expr.AsBool(), expr.AllowUndefinedVariables())
		if err != nil {
			return DryRunResult{RuleID: ruleID, Error: "compile error: " + err.Error()}
		}
		rule = &compiledRule{
			ID:            ruleID,
			Name:          strOrDefault(rec.Get("name"), ""),
			Program:       program,
			ConditionExpr: condExpr,
			CooldownSec:   intFromRecord(rec, "cooldown_seconds"),
		}
	}

	env := e.buildExprEnv(ctx)
	result, err := expr.Run(rule.Program, env)
	if err != nil {
		return DryRunResult{RuleID: ruleID, RuleName: rule.Name, Env: sanitizeEnv(env), Error: err.Error()}
	}
	condResult, _ := result.(bool)
	cooldownActive := !e.checkCooldown(rule.ID, rule.CooldownSec)
	return DryRunResult{
		RuleID:          ruleID,
		RuleName:        rule.Name,
		ConditionResult: condResult,
		WouldFire:       condResult && !cooldownActive,
		CooldownActive:  cooldownActive,
		Env:             sanitizeEnv(env),
	}
}

func (e *AutomationEngine) buildExprEnv(ctx TriggerContext) map[string]any {
	env := map[string]any{
		"device_eui":  ctx.DeviceEUI,
		"device_name": ctx.DeviceName,
		"now":         time.Now(),
		"hour":        time.Now().Hour(),
	}
	// Flatten telemetry fields to top level
	for k, v := range ctx.Telemetry {
		env[k] = v
	}
	// State change fields
	if ctx.Type == TriggerStateChange {
		env["control_key"] = ctx.ControlKey
		env["old_state"] = ctx.OldState
		env["new_state"] = ctx.NewState
		env["source"] = ctx.Source
	}
	// Cross-device helper functions
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

func (e *AutomationEngine) checkCooldown(ruleID string, cooldownSec int) bool {
	if cooldownSec <= 0 {
		return true
	}
	e.mu.RLock()
	lastFired, ok := e.cooldowns[ruleID]
	e.mu.RUnlock()
	if !ok {
		return true
	}
	return time.Since(lastFired) >= time.Duration(cooldownSec)*time.Second
}

func (e *AutomationEngine) recordCooldown(ruleID string) {
	e.mu.Lock()
	e.cooldowns[ruleID] = time.Now()
	e.mu.Unlock()
}

func (e *AutomationEngine) executeAction(rule compiledRule) error {
	cfg := e.gwState.Config()
	if cfg == nil || !cfg.Valid() {
		return nil // Silently skip if gateway is offline
	}

	switch rule.ActionType {
	case "setControl":
		targetEUI, _ := rule.ActionConfig["target_eui"].(string)
		control, _ := rule.ActionConfig["control"].(string)
		state, _ := rule.ActionConfig["state"].(string)
		duration := int(getFloat64(rule.ActionConfig["duration"]))
		if targetEUI == "" || control == "" {
			return nil
		}
		return ExecuteSetControl(e.app, cfg, SetControlParams{
			DeviceEUI: targetEUI, Control: control, State: state,
			Duration: duration, InitiatedBy: "automation",
		})
	case "sendCommand":
		targetEUI, _ := rule.ActionConfig["target_eui"].(string)
		command, _ := rule.ActionConfig["command"].(string)
		if targetEUI == "" || command == "" {
			return nil
		}
		var value *uint32
		if v, ok := rule.ActionConfig["value"]; ok {
			u := uint32(getFloat64(v))
			value = &u
		}
		return ExecuteSendCommand(e.app, cfg, SendCommandParams{
			DeviceEUI: targetEUI, Command: command, Value: value, InitiatedBy: "automation",
		})
	default:
		return nil
	}
}

func (e *AutomationEngine) logAutomation(rule compiledRule, ctx TriggerContext, condResult bool, status, errMsg string, env map[string]any) {
	coll, err := e.app.FindCollectionByNameOrId("automation_log")
	if err != nil {
		return
	}
	rec := core.NewRecord(coll)
	rec.Set("automation_id", rule.ID)
	rec.Set("automation_name", rule.Name)
	rec.Set("trigger_device", ctx.DeviceEUI)
	rec.Set("trigger_type", string(ctx.Type))
	rec.Set("condition_result", condResult)
	rec.Set("status", status)
	if errMsg != "" {
		rec.Set("error_message", errMsg)
	}
	// Snapshot env for debugging (strip functions)
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
			continue // skip functions
		default:
			out[k] = v
		}
	}
	return out
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
