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
	// MQTTTLSEnabled turns on the device-facing TLS listener. Off by default so an
	// on-prem/edge box deploys with no certificates at all (plain TCP only). On
	// (managed cloud) it serves TLS on MQTTTLSAddr and requires a cert/key.
	MQTTTLSEnabled bool
	// MQTTTLSAddr is the device-facing TLS listener address (used only when
	// MQTTTLSEnabled). Matches the firmware default port (8883).
	MQTTTLSAddr string
	// MQTTTLSCert / MQTTTLSKey are filesystem paths to the PEM cert and key the
	// TLS listener serves. Mounted into the container (a Coolify secret), kept out
	// of the data volume. Required when MQTTTLSEnabled.
	MQTTTLSCert string
	MQTTTLSKey  string
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
	// HTTPPublicURL is the externally-reachable origin (scheme://host[:port]) that
	// DEVICES use to reach this server's HTTP API — currently the OTA firmware
	// download. Empty falls back to reconstructing the origin from the admin's
	// request, which is correct when the device and admin reach the same host; set
	// it explicitly when a TLS-terminating proxy hides the scheme or the device
	// reaches a different host than the admin's browser.
	HTTPPublicURL string
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
		MQTTTLSEnabled: envBool("MAJI_MQTT_TLS_ENABLED", false),
		MQTTTLSAddr:    env("MAJI_MQTT_TLS", ":8883"),
		MQTTTLSCert:    env("MAJI_MQTT_TLS_CERT", ""),
		MQTTTLSKey:     env("MAJI_MQTT_TLS_KEY", ""),
		MQTTPublicHost: env("MAJI_MQTT_PUBLIC_HOST", "mqtt.majiflow.io"),
		MQTTPublicPort: envInt("MAJI_MQTT_PUBLIC_PORT", 8883),
		MQTTPublicTLS:  envBool("MAJI_MQTT_PUBLIC_TLS", true),
		HTTPPublicURL:  env("MAJI_HTTP_PUBLIC_URL", ""),
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
