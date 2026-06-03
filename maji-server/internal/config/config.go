// Package config loads runtime configuration for the maji-server binaries.
package config

import "os"

// Mode selects the deployment shape. The cloud binary is multi-tenant; the
// edge binary is single-tenant and compiles out the tenant package entirely.
type Mode string

const (
	ModeCloud Mode = "cloud"
	ModeEdge  Mode = "edge"
)

// Config holds the resolved server configuration.
type Config struct {
	Mode Mode
	// SPADir is the directory of the built Angular SPA to serve. Empty disables
	// static serving (e.g. during local backend-only development).
	SPADir string
	// MQTTTCPAddr is the device-facing MQTT listener address.
	MQTTTCPAddr string
	// MQTTWSAddr is the browser-facing MQTT-over-WebSocket listener address.
	MQTTWSAddr string
}

// Load resolves configuration from the environment for the given mode.
func Load(mode Mode) Config {
	return Config{
		Mode:        mode,
		SPADir:      env("MAJI_SPA_DIR", ""),
		MQTTTCPAddr: env("MAJI_MQTT_TCP", ":1883"),
		MQTTWSAddr:  env("MAJI_MQTT_WS", ":8082"),
	}
}

func env(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}
