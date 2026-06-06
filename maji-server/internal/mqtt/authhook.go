package mqtt

import (
	"strings"

	"github.com/kisinga/majiflow/internal/auth"
	mqtt "github.com/mochi-mqtt/server/v2"
	"github.com/mochi-mqtt/server/v2/packets"
	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/core"
)

// deviceAuthHook authenticates MQTT devices against the controllers collection
// (username = device_id, password = raw token verified against token_hash) and
// confines each device to its own topic namespace.
type deviceAuthHook struct {
	mqtt.HookBase
	app core.App
}

func (h *deviceAuthHook) ID() string { return "maji-device-auth" }

func (h *deviceAuthHook) Provides(b byte) bool {
	return b == mqtt.OnConnectAuthenticate || b == mqtt.OnACLCheck
}

func (h *deviceAuthHook) OnConnectAuthenticate(cl *mqtt.Client, pk packets.Packet) bool {
	deviceID := string(pk.Connect.Username)
	token := string(pk.Connect.Password)
	if deviceID == "" || token == "" {
		return false
	}
	rec, err := h.app.FindFirstRecordByFilter(
		"controllers", "device_id = {:d}", dbx.Params{"d": deviceID},
	)
	if err != nil || rec == nil {
		return false
	}
	return auth.VerifyToken(rec.GetString("token_hash"), token)
}

// OnACLCheck confines a device to its own namespace `majiflow/{site}/{device_id}/…`
// (plus the ESPHome discovery lane). Cross-controller coordination is device↔device
// over UDP, so the broker carries only each device's own telemetry / command / status.
func (h *deviceAuthHook) OnACLCheck(cl *mqtt.Client, topic string, _ bool) bool {
	deviceID := string(cl.Properties.Username)
	if deviceID == "" {
		return false
	}
	parts := strings.Split(topic, "/")
	// ESPHome's own dashboard discovery uses absolute `esphome/*` topics
	// (esphome/discover/<name>, esphome/ping/<name>) outside our namespace, and
	// the firmware publishes the retained discover message unconditionally.
	// REJECTING it makes mochi treat the packet as a processing error and reset the
	// connection — a reconnect loop that blocks telemetry. Allow authenticated
	// controllers this discovery-metadata namespace (no telemetry/control rides here).
	if len(parts) > 0 && parts[0] == "esphome" {
		return true
	}
	// Own namespace only: majiflow/{site}/{device_id}/…
	return len(parts) >= 3 && parts[0] == "majiflow" && parts[2] == deviceID
}
