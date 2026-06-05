// Package config loads runtime configuration for the maji-server binaries.
package config

import (
	"os"
	"strconv"
)

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
	// MQTTTCPAddr is the address the broker BINDS to (device-facing listener).
	MQTTTCPAddr string
	// MQTTWSAddr is the browser-facing MQTT-over-WebSocket listener address.
	MQTTWSAddr string
	// MQTTPublicHost is the broker host/IP that DEVICES use to reach the broker,
	// baked into generated firmware. MQTTTCPAddr is where the broker binds; this
	// is how a device on the network connects to it — set it to the server's LAN
	// IP or public hostname. Empty until configured (firmware then has no broker).
	MQTTPublicHost string
	// MQTTPublicPort is the device-facing broker port baked into firmware.
	MQTTPublicPort int
	// MQTTPublicTLS reports whether the device-facing broker endpoint uses TLS.
	// The managed cloud broker (mqtt.majiflow.io:8883) is TLS; a local on-site
	// broker may not be. Baked into firmware and offered as the Online autofill.
	MQTTPublicTLS bool
}

// Load resolves configuration from the environment for the given mode. The
// public-broker defaults point at the managed cloud (mqtt.majiflow.io:8883,
// TLS); an edge box overrides them via env to its own LAN broker.
func Load(mode Mode) Config {
	return Config{
		Mode:           mode,
		SPADir:         env("MAJI_SPA_DIR", ""),
		MQTTTCPAddr:    env("MAJI_MQTT_TCP", ":1883"),
		MQTTWSAddr:     env("MAJI_MQTT_WS", ":8082"),
		MQTTPublicHost: env("MAJI_MQTT_PUBLIC_HOST", "mqtt.majiflow.io"),
		MQTTPublicPort: envInt("MAJI_MQTT_PUBLIC_PORT", 8883),
		MQTTPublicTLS:  envBool("MAJI_MQTT_PUBLIC_TLS", true),
	}
}

func env(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}

func envInt(key string, def int) int {
	if v := os.Getenv(key); v != "" {
		if n, err := strconv.Atoi(v); err == nil {
			return n
		}
	}
	return def
}

func envBool(key string, def bool) bool {
	if v := os.Getenv(key); v != "" {
		if b, err := strconv.ParseBool(v); err == nil {
			return b
		}
	}
	return def
}
