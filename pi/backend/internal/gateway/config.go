package gateway

// Config holds concentratord/gateway settings. Load from DB only; see DefaultGatewayConfig for first-time defaults.
// Concentratord is always external; we only connect via ZMQ (event_url, command_url).
type Config struct {
	EventURL       string
	CommandURL     string
	GatewayID      string
	Region         string // e.g. "EU868", "US915"; selects RegionProfile for RX1 frequency and modulation
	RX1FrequencyHz uint32 // optional; 0 = use region profile default
}

// DataDownlinkRX1DelaySec is the Class A RX1 window delay for data downlinks (LoRaWAN default, 1s).
// This is encoded in the JoinAccept RxDelay field, so it cannot change after join.
// JoinAccept itself always uses JoinAcceptDelaySec (5s, per spec JOIN_ACCEPT_DELAY1).
const DataDownlinkRX1DelaySec = 1

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
		RX1FrequencyHz: 0,
	}
}

// Valid returns true if event_url, command_url, and region are all set (pipeline may start, downlink allowed).
func (c *Config) Valid() bool {
	return c.EventURL != "" && c.CommandURL != "" && c.Region != ""
}
