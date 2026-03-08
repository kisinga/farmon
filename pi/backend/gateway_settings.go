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

// GatewayState holds mutable gateway config, pipeline cancel, and optional concentratord process.
type GatewayState struct {
	cfg      *gateway.Config
	cancel   context.CancelFunc
	concProc *concentratordProcess
	mu       sync.Mutex
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
// If ManageConcentratord is true, writes TOML and starts/stops the concentratord subprocess.
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
	cfg := *s.cfg
	if cfg.ManageConcentratord {
		if s.concProc == nil {
			s.concProc = &concentratordProcess{}
		}
		_ = s.concProc.stop()
		configPath := DefaultConcentratordConfigPath
		if err := writeConcentratordTOML(cfg, configPath); err != nil {
			log.Printf("concentratord: write TOML: %v", err)
			return
		}
		binPath := DefaultConcentratordBinPath
		if err := s.concProc.start(binPath, configPath); err != nil {
			log.Printf("concentratord: start process: %v", err)
			return
		}
		log.Printf("concentratord: started subprocess (manage_concentratord=true)")
	}
	ctx, cancel := context.WithCancel(context.Background())
	s.mu.Lock()
	s.cancel = cancel
	s.mu.Unlock()
	startConcentratordPipeline(ctx, app, s.cfg)
}

// gatewaySettingsResponse is the JSON shape for GET/PATCH /api/gateway-settings.
type gatewaySettingsResponse struct {
	Region               string `json:"region"`
	EventURL             string `json:"event_url"`
	CommandURL           string `json:"command_url"`
	GatewayID            string `json:"gateway_id"`
	RX1Delay             int    `json:"rx1_delay"`
	RX1FrequencyHz       uint32 `json:"rx1_frequency_hz"`
	ManageConcentratord  bool   `json:"manage_concentratord"`
	Saved                bool   `json:"saved"` // true if a record exists in DB
}

func configToResponse(c gateway.Config, saved bool) gatewaySettingsResponse {
	return gatewaySettingsResponse{
		Region:              c.Region,
		EventURL:            c.EventURL,
		CommandURL:          c.CommandURL,
		GatewayID:           c.GatewayID,
		RX1Delay:            c.RX1DelaySec,
		RX1FrequencyHz:      c.RX1FrequencyHz,
		ManageConcentratord: c.ManageConcentratord,
		Saved:               saved,
	}
}

func getGatewaySettingsHandler(app core.App) func(*core.RequestEvent) error {
	return func(e *core.RequestEvent) error {
		cfg, saved := LoadGatewaySettings(app)
		if !saved {
			cfg = gateway.DefaultGatewayConfig()
		}
		return e.JSON(http.StatusOK, configToResponse(cfg, saved))
	}
}

// patchGatewaySettingsBody is the PATCH request body.
type patchGatewaySettingsBody struct {
	Region              *string `json:"region,omitempty"`
	EventURL            *string `json:"event_url,omitempty"`
	CommandURL         *string `json:"command_url,omitempty"`
	GatewayID          *string `json:"gateway_id,omitempty"`
	RX1Delay            *int    `json:"rx1_delay,omitempty"`
	RX1FrequencyHz      *uint32 `json:"rx1_frequency_hz,omitempty"`
	ManageConcentratord *bool   `json:"manage_concentratord,omitempty"`
}

func patchGatewaySettingsHandler(app core.App, state *GatewayState) func(*core.RequestEvent) error {
	return func(e *core.RequestEvent) error {
		var body patchGatewaySettingsBody
		if err := e.BindBody(&body); err != nil {
			return e.String(http.StatusBadRequest, "invalid body")
		}
		cfg, _ := LoadGatewaySettings(app)
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
		if body.ManageConcentratord != nil {
			cfg.ManageConcentratord = *body.ManageConcentratord
		}
		if !cfg.Valid() {
			return e.JSON(http.StatusBadRequest, map[string]string{"error": "event_url, command_url, and region are required"})
		}
		if err := SaveGatewaySettings(app, cfg); err != nil {
			log.Printf("gateway-settings PATCH: save: %v", err)
			return e.JSON(http.StatusInternalServerError, map[string]string{"error": err.Error()})
		}
		state.SetConfig(cfg)
		state.RestartPipeline(app)
		return e.JSON(http.StatusOK, configToResponse(cfg, true))
	}
}
