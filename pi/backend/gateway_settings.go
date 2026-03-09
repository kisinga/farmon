package main

import (
	"context"
	"net/http"
	"strings"
	"sync"

	"github.com/pocketbase/pocketbase/core"

	"github.com/kisinga/farmon/pi/internal/gateway"
)

// --- Gateway settings DB load/save (single-record gateway_settings collection) ---
// Frontend reads/writes gateway_settings via SDK; backend loads at serve and on POST /api/farmon/pipeline/restart (reload + restart).

func loadGatewaySettings(app core.App) (gateway.Config, bool) {
	records, err := app.FindRecordsByFilter("gateway_settings", "", "created", 1, 0, nil)
	if err != nil || len(records) == 0 {
		return gateway.DefaultGatewayConfig(), false
	}
	cfg := recordToGatewayConfig(records[0])
	return cfg, cfg.Valid()
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
	records, err := app.FindRecordsByFilter("gateway_settings", "", "created", 1, 0, nil)
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
	if n := numberFromRecord(rec, "rx1_delay"); n >= gateway.MinRX1DelaySec() && n <= gateway.MaxRX1DelaySec() {
		cfg.RX1DelaySec = n
	}
	if n := numberFromRecord(rec, "rx1_frequency_hz"); n > 0 {
		cfg.RX1FrequencyHz = uint32(n)
	}
	return cfg
}

func configToRecord(rec *core.Record, cfg gateway.Config) {
	rec.Set("region", cfg.Region)
	rec.Set("event_url", cfg.EventURL)
	rec.Set("command_url", cfg.CommandURL)
	rec.Set("gateway_id", cfg.GatewayID)
	rec.Set("rx1_delay", cfg.RX1DelaySec)
	rec.Set("rx1_frequency_hz", cfg.RX1FrequencyHz)
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
		return
	}
	if !s.cfg.Valid() {
		return
	}
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
		cfg, valid := loadGatewaySettings(app)
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
