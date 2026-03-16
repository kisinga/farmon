package main

import (
	"context"
	"log"
	"net/http"
	"strings"
	"sync"

	"github.com/pocketbase/pocketbase/core"

	"github.com/kisinga/farmon/pi/internal/gateway"
)

// --- Gateway settings DB load/save (single-record gateway_settings collection) ---
// Frontend reads/writes gateway_settings via SDK; backend loads at serve and on POST /api/farmon/pipeline/restart (reload + restart).
// We use sort "-@rowid" and limit 1 so we get one record (gateway_settings has no "created" field in schema).

// ConfigStatus describes why the pipeline is or isn't configured; used by the debug API and logging.
const (
	ConfigStatusValid            = "valid"
	ConfigStatusMissingRecord    = "missing_record"
	ConfigStatusEmptyEventURL     = "empty_event_url"
	ConfigStatusEmptyCommandURL  = "empty_command_url"
	ConfigStatusEmptyRegion      = "empty_region"
)

func configStatus(cfg gateway.Config, recordFound bool) string {
	if !recordFound {
		return ConfigStatusMissingRecord
	}
	if strings.TrimSpace(cfg.EventURL) == "" {
		return ConfigStatusEmptyEventURL
	}
	if strings.TrimSpace(cfg.CommandURL) == "" {
		return ConfigStatusEmptyCommandURL
	}
	if strings.TrimSpace(cfg.Region) == "" {
		return ConfigStatusEmptyRegion
	}
	return ConfigStatusValid
}

func loadGatewaySettings(app core.App) (gateway.Config, bool) {
	cfg, valid, _ := loadGatewaySettingsWithStatus(app)
	return cfg, valid
}

// loadGatewaySettingsWithStatus returns config, valid, and a status string for the debug API.
func loadGatewaySettingsWithStatus(app core.App) (gateway.Config, bool, string) {
	records, err := app.FindRecordsByFilter("gateway_settings", "", "-@rowid", 1, 0, nil)
	recordFound := err == nil && len(records) > 0
	var cfg gateway.Config
	if !recordFound {
		cfg = gateway.DefaultGatewayConfig()
		status := configStatus(cfg, false)
		log.Printf("gateway_settings: no record found, status=%s", status)
		return cfg, false, status
	}
	cfg = recordToGatewayConfig(records[0])
	valid := cfg.Valid()
	status := configStatus(cfg, true)
	eventSet := "empty"
	if strings.TrimSpace(cfg.EventURL) != "" {
		eventSet = "set"
	}
	cmdSet := "empty"
	if strings.TrimSpace(cfg.CommandURL) != "" {
		cmdSet = "set"
	}
	log.Printf("gateway_settings: valid=%t status=%s event_url=%s command_url=%s region=%s", valid, status, eventSet, cmdSet, cfg.Region)
	return cfg, valid, status
}

func saveGatewaySettings(app core.App, cfg gateway.Config) error {
	coll, err := app.FindCollectionByNameOrId("gateway_settings")
	if err != nil || coll == nil {
		return err
	}
	rec, err := getGatewaySettingsRecord(app)
	var toSave *core.Record
	if err != nil || rec == nil {
		toSave = core.NewRecord(coll)
	} else {
		toSave = rec
	}
	configToRecord(toSave, cfg)
	return app.Save(toSave)
}

func getGatewaySettingsRecord(app core.App) (*core.Record, error) {
	// Use -@rowid so we get one record (schema has no "created" field)
	records, err := app.FindRecordsByFilter("gateway_settings", "", "-@rowid", 1, 0, nil)
	if err != nil || len(records) == 0 {
		return nil, err
	}
	return records[0], nil
}

func getRecordString(rec *core.Record, field string) string {
	if rec == nil {
		return ""
	}
	v := rec.Get(field)
	s, _ := v.(string)
	return strings.TrimSpace(s)
}

func numberFromRecord(rec *core.Record, field string) int {
	if rec == nil {
		return 0
	}
	v := rec.Get(field)
	if v == nil {
		return 0
	}
	switch n := v.(type) {
	case float64:
		return int(n)
	case int:
		return n
	case int64:
		return int(n)
	default:
		return 0
	}
}

func recordToGatewayConfig(rec *core.Record) gateway.Config {
	cfg := gateway.DefaultGatewayConfig()
	cfg.EventURL = getRecordString(rec, "event_url")
	cfg.CommandURL = getRecordString(rec, "command_url")
	cfg.GatewayID = getRecordString(rec, "gateway_id")
	if r := getRecordString(rec, "region"); r != "" {
		cfg.Region = strings.ToUpper(r)
	}
	if n := numberFromRecord(rec, "rx1_frequency_hz"); n > 0 {
		cfg.RX1FrequencyHz = uint32(n)
	}
	if v := rec.Get("test_mode"); v != nil {
		if b, ok := v.(bool); ok {
			cfg.TestMode = b
		}
	}
	return cfg
}

func configToRecord(rec *core.Record, cfg gateway.Config) {
	rec.Set("region", cfg.Region)
	rec.Set("event_url", cfg.EventURL)
	rec.Set("command_url", cfg.CommandURL)
	rec.Set("gateway_id", cfg.GatewayID)
	rec.Set("rx1_frequency_hz", cfg.RX1FrequencyHz)
	rec.Set("test_mode", cfg.TestMode)
}

// GatewayState holds mutable gateway config, runtime state, and pipeline cancel. Concentratord is always external; we only connect via ZMQ.
type GatewayState struct {
	cfg     *gateway.Config
	runtime *GatewayRuntimeState
	cancel  context.CancelFunc
	mu      sync.RWMutex
}

// Config returns the current gateway config (for handlers). May be nil.
func (s *GatewayState) Config() *gateway.Config {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.cfg
}

// Runtime returns the gateway runtime state (for handlers). May be nil.
func (s *GatewayState) Runtime() *GatewayRuntimeState {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.runtime
}

// SetConfig updates the in-memory config (e.g. after loading from DB or PATCH).
func (s *GatewayState) SetConfig(cfg gateway.Config) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.cfg != nil {
		*s.cfg = cfg
	}
}

// RestartPipeline cancels the current pipeline (if any) and starts it again if config is valid.
func (s *GatewayState) RestartPipeline(app core.App) {
	s.mu.Lock()
	if s.cancel != nil {
		s.cancel()
		s.cancel = nil
	}
	s.mu.Unlock()
	if s.cfg == nil {
		log.Printf("RestartPipeline: skipping (no config)")
		return
	}
	if s.cfg.TestMode {
		log.Printf("RestartPipeline: test mode enabled — skipping concentratord pipeline (uplinks via inject only)")
		return
	}
	if !s.cfg.Valid() {
		status := configStatus(*s.cfg, true)
		log.Printf("RestartPipeline: skipping (config invalid, status=%s)", status)
		return
	}
	log.Printf("RestartPipeline: config valid=true, starting pipeline")
	ctx, cancel := context.WithCancel(context.Background())
	s.mu.Lock()
	s.cancel = cancel
	s.mu.Unlock()
	startConcentratordPipeline(ctx, app, s.cfg, s.runtime)
}

// pipelineRestartHandler loads gateway_settings from DB, applies to runtime, and restarts the pipeline.
// POST /api/farmon/pipeline/restart — no body. Called by frontend after saving gateway_settings via SDK.
func pipelineRestartHandler(app core.App, state *GatewayState) func(*core.RequestEvent) error {
	return func(e *core.RequestEvent) error {
		cfg, valid, _ := loadGatewaySettingsWithStatus(app)
		if !valid {
			invalid := gateway.DefaultGatewayConfig()
			invalid.EventURL = ""
			invalid.CommandURL = ""
			state.SetConfig(invalid)
		} else {
			state.SetConfig(cfg)
		}
		state.RestartPipeline(app)
		return e.JSON(http.StatusOK, map[string]any{"ok": true})
	}
}
