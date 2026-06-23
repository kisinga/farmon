// Package mqtt embeds a Mochi MQTT broker into maji-server.
package mqtt

import (
	"crypto/tls"
	"fmt"

	"github.com/kisinga/majiflow/internal/config"
	mqtt "github.com/mochi-mqtt/server/v2"
	"github.com/mochi-mqtt/server/v2/listeners"
	"github.com/pocketbase/pocketbase/core"
)

// Broker wraps the embedded Mochi server and its lifecycle.
type Broker struct {
	Server *mqtt.Server
}

// Start brings up the broker with a device-facing TCP listener and a
// browser-facing WebSocket listener, registers the device-token auth and
// telemetry ingest hooks, then serves in the background.
//
// Browser MQTT-over-WebSocket auth (PocketBase JWT) is wired in Phase 5; until
// then the WS listener is governed by the same strict device-auth hook.
func Start(app core.App, cfg config.Config) (*Broker, error) {
	server := mqtt.New(&mqtt.Options{InlineClient: true})

	if err := server.AddHook(&deviceAuthHook{app: app}, nil); err != nil {
		return nil, err
	}
	// The Mochi server is itself the Publisher (InlineClient), used for the retained
	// runs_ack high-water-mark uplink from the ingest path.
	if err := server.AddHook(&ingestHook{app: app, pub: server}, nil); err != nil {
		return nil, err
	}

	tcp := listeners.NewTCP(listeners.Config{ID: "tcp", Address: cfg.MQTTTCPAddr})
	if err := server.AddListener(tcp); err != nil {
		return nil, err
	}

	ws := listeners.NewWebsocket(listeners.Config{ID: "ws", Address: cfg.MQTTWSAddr})
	if err := server.AddListener(ws); err != nil {
		return nil, err
	}

	// Device-facing TLS listener (managed cloud). Off by default so on-prem/edge
	// boxes run plain-only with no certificates; when enabled the cert/key are
	// required and the firmware's default 8883/TLS endpoint is actually served.
	if cfg.MQTTTLSEnabled {
		if cfg.MQTTTLSCert == "" || cfg.MQTTTLSKey == "" {
			return nil, fmt.Errorf("MAJI_MQTT_TLS_ENABLED is set but MAJI_MQTT_TLS_CERT/MAJI_MQTT_TLS_KEY are missing")
		}
		cert, err := tls.LoadX509KeyPair(cfg.MQTTTLSCert, cfg.MQTTTLSKey)
		if err != nil {
			return nil, fmt.Errorf("load MQTT TLS keypair: %w", err)
		}
		// Send only the leaf in the handshake, never the self-signed root. fullchain.pem
		// is leaf+CA (the CA is needed to derive the firmware trust anchor), but per TLS
		// the server must not transmit its own root — the device already pins it. Strict
		// embedded stacks (ESP32 mbedTLS) reject a presented chain that contains a
		// self-signed cert matching the trust anchor (X509_CERT_VERIFY_FAILED → a TLS
		// unknown_ca alert), so drop everything after the leaf.
		if len(cert.Certificate) > 1 {
			cert.Certificate = cert.Certificate[:1]
		}
		tlsListener := listeners.NewTCP(listeners.Config{
			ID:        "tls",
			Address:   cfg.MQTTTLSAddr,
			TLSConfig: &tls.Config{Certificates: []tls.Certificate{cert}},
		})
		if err := server.AddListener(tlsListener); err != nil {
			return nil, err
		}
	}

	go func() { _ = server.Serve() }()

	return &Broker{Server: server}, nil
}

// Close shuts down the broker.
func (b *Broker) Close() error {
	return b.Server.Close()
}
