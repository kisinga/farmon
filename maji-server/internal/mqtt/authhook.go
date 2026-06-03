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

// OnACLCheck confines a device to topics under `majiflow/{site}/{device_id}/…`.
func (h *deviceAuthHook) OnACLCheck(cl *mqtt.Client, topic string, write bool) bool {
	deviceID := string(cl.Properties.Username)
	if deviceID == "" {
		return false
	}
	parts := strings.Split(topic, "/")
	return len(parts) >= 3 && parts[0] == "majiflow" && parts[2] == deviceID
}
