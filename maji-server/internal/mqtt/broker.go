// Package mqtt embeds a Mochi MQTT broker into maji-server.
package mqtt

import (
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
	if err := server.AddHook(&ingestHook{app: app}, nil); err != nil {
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

	go func() { _ = server.Serve() }()

	return &Broker{Server: server}, nil
}

// Close shuts down the broker.
func (b *Broker) Close() error {
	return b.Server.Close()
}
