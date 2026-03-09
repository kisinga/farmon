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
// The backend must own load/save so it can load at serve, return GET, and on PATCH validate + save + restart pipeline.
// The frontend could use the SDK to read/write the same record, but pipeline restart is triggered only by our PATCH.

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

// GatewayState holds mutable gateway config and pipeline cancel. Concentratord is always external; we only connect via ZMQ.
type GatewayState struct {
	cfg    *gateway.Config
	cancel context.CancelFunc
	mu     sync.Mutex
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
	startConcentratordPipeline(ctx, app, s.cfg)
}

// gatewaySettingsResponse is the JSON shape for GET/PATCH /api/gateway-settings.
type gatewaySettingsResponse struct {
	Region         string `json:"region"`
	EventURL       string `json:"event_url"`
	CommandURL     string `json:"command_url"`
	GatewayID      string `json:"gateway_id"`
	RX1Delay       int    `json:"rx1_delay"`
	RX1FrequencyHz uint32 `json:"rx1_frequency_hz"`
	Saved          bool   `json:"saved"` // true if a record exists in DB
}

func configToResponse(c gateway.Config, saved bool) gatewaySettingsResponse {
	return gatewaySettingsResponse{
		Region:         c.Region,
		EventURL:       c.EventURL,
		CommandURL:     c.CommandURL,
		GatewayID:      c.GatewayID,
		RX1Delay:       c.RX1DelaySec,
		RX1FrequencyHz: c.RX1FrequencyHz,
		Saved:          saved,
	}
}

func getGatewaySettingsHandler(app core.App, inMemoryCfg *gateway.Config) func(*core.RequestEvent) error {
	return func(e *core.RequestEvent) error {
		cfg, saved := loadGatewaySettings(app)
		if !saved {
			cfg = gateway.DefaultGatewayConfig()
		}
		resp := configToResponse(cfg, saved)
		// Autofill gateway_id in UI from discovered value when not persisted (DB empty, in-memory set).
		if resp.GatewayID == "" && inMemoryCfg != nil && inMemoryCfg.GatewayID != "" {
			resp.GatewayID = inMemoryCfg.GatewayID
		}
		return e.JSON(http.StatusOK, resp)
	}
}

// patchGatewaySettingsBody is the PATCH request body.
type patchGatewaySettingsBody struct {
	Region         *string `json:"region,omitempty"`
	EventURL       *string `json:"event_url,omitempty"`
	CommandURL     *string `json:"command_url,omitempty"`
	GatewayID      *string `json:"gateway_id,omitempty"`
	RX1Delay       *int    `json:"rx1_delay,omitempty"`
	RX1FrequencyHz *uint32 `json:"rx1_frequency_hz,omitempty"`
}

func patchGatewaySettingsHandler(app core.App, state *GatewayState) func(*core.RequestEvent) error {
	return func(e *core.RequestEvent) error {
		var body patchGatewaySettingsBody
		if err := e.BindBody(&body); err != nil {
			return e.String(http.StatusBadRequest, "invalid body")
		}
		cfg, _ := loadGatewaySettings(app)
		if body.Region != nil {
			cfg.Region = strings.TrimSpace(strings.ToUpper(*body.Region))
		}
		if body.EventURL != nil {
			cfg.EventURL = strings.TrimSpace(*body.EventURL)
		}
		if body.CommandURL != nil {
			cfg.CommandURL = strings.TrimSpace(*body.CommandURL)
		}
		if body.GatewayID != nil {
			cfg.GatewayID = strings.TrimSpace(*body.GatewayID)
		}
		if body.RX1Delay != nil {
			d := *body.RX1Delay
			if d < gateway.MinRX1DelaySec() {
				d = gateway.MinRX1DelaySec()
			}
			if d > gateway.MaxRX1DelaySec() {
				d = gateway.MaxRX1DelaySec()
			}
			cfg.RX1DelaySec = d
		}
		if body.RX1FrequencyHz != nil {
			cfg.RX1FrequencyHz = *body.RX1FrequencyHz
		}
		if !cfg.Valid() {
			return e.JSON(http.StatusBadRequest, map[string]string{"error": "event_url, command_url, and region are required"})
		}
		if err := saveGatewaySettings(app, cfg); err != nil {
			log.Printf("gateway-settings PATCH: save: %v", err)
			return e.JSON(http.StatusInternalServerError, map[string]string{"error": err.Error()})
		}
		state.SetConfig(cfg)
		state.RestartPipeline(app)
		return e.JSON(http.StatusOK, configToResponse(cfg, true))
	}
}
