package gateway

// Config holds concentratord/gateway settings. Load from DB only; see DefaultGatewayConfig for first-time defaults.
// Concentratord is always external; we only connect via ZMQ (event_url, command_url).
type Config struct {
	EventURL        string
	CommandURL      string
	GatewayID       string
	Region          string  // e.g. "EU868", "US915"; selects RegionProfile for RX1 frequency and modulation
	RX1DelaySec     int     // 1–15; delay in seconds for Class A RX1
	RX1FrequencyHz  uint32  // optional; 0 = use region profile default
}

const (
	defaultRX1DelaySec = 1
	minRX1DelaySec     = 1
	maxRX1DelaySec     = 15
)

// MinRX1DelaySec and MaxRX1DelaySec are the allowed range for RX1 delay (Class A).
func MinRX1DelaySec() int { return minRX1DelaySec }
func MaxRX1DelaySec() int { return maxRX1DelaySec }

// DefaultGatewayConfig returns defaults matching setup_gateway.sh so one "Save" gives a working config.
const (
	DefaultEventURL   = "ipc:///tmp/concentratord_event"
	DefaultCommandURL = "ipc:///tmp/concentratord_command"
	DefaultRegion     = "US915"
)

func DefaultGatewayConfig() Config {
	return Config{
		EventURL:       DefaultEventURL,
		CommandURL:     DefaultCommandURL,
		GatewayID:      "",
		Region:         DefaultRegion,
		RX1DelaySec:    defaultRX1DelaySec,
		RX1FrequencyHz: 0,
	}
}

// Valid returns true if event_url, command_url, and region are all set (pipeline may start, downlink allowed).
func (c *Config) Valid() bool {
	return c.EventURL != "" && c.CommandURL != "" && c.Region != ""
}
