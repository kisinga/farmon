package gateway

import (
	"os"
	"strconv"
	"strings"
)

// Config holds concentratord/gateway settings. Load once from env and pass to pipeline and handlers.
type Config struct {
	EventURL        string
	CommandURL      string
	GatewayID       string
	Region          string // e.g. "US915"; used to push gateway channel config so TX matches RX band
	RX1DelaySec     int    // 1–15; delay in seconds for Class A RX1 (join-accept and data downlinks)
	RX1FrequencyHz  uint32 // optional; 0 means not set
}

const (
	defaultRX1DelaySec = 1
	minRX1DelaySec     = 1
	maxRX1DelaySec     = 15
)

// LoadFromEnv returns config from environment variables.
// CONCENTRATORD_EVENT_URL, CONCENTRATORD_COMMAND_URL, CONCENTRATORD_GATEWAY_ID,
// CONCENTRATORD_RX1_DELAY (optional, default 1, clamped 1–15),
// CONCENTRATORD_RX1_FREQUENCY_HZ (optional).
func LoadFromEnv() Config {
	cfg := Config{
		EventURL:   strings.TrimSpace(os.Getenv("CONCENTRATORD_EVENT_URL")),
		CommandURL: strings.TrimSpace(os.Getenv("CONCENTRATORD_COMMAND_URL")),
		GatewayID:  strings.TrimSpace(os.Getenv("CONCENTRATORD_GATEWAY_ID")),
		Region:     strings.TrimSpace(strings.ToUpper(os.Getenv("CONCENTRATORD_REGION"))),
	}
	cfg.RX1DelaySec = defaultRX1DelaySec
	if s := strings.TrimSpace(os.Getenv("CONCENTRATORD_RX1_DELAY")); s != "" {
		if n, err := strconv.Atoi(s); err == nil && n >= minRX1DelaySec && n <= maxRX1DelaySec {
			cfg.RX1DelaySec = n
		}
	}
	if s := strings.TrimSpace(os.Getenv("CONCENTRATORD_RX1_FREQUENCY_HZ")); s != "" {
		if n, err := strconv.ParseUint(s, 10, 32); err == nil && n > 0 {
			cfg.RX1FrequencyHz = uint32(n)
		}
	}
	return cfg
}

// Enabled returns true if both event and command URLs are set.
func (c *Config) Enabled() bool {
	return c.EventURL != "" && c.CommandURL != ""
}
