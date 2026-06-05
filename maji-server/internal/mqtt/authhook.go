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

// OnACLCheck confines a device to its own namespace `majiflow/{site}/{device_id}/…`,
// plus two same-site cross-controller lanes for local-mode coordination:
//   - `majiflow/{site}/{anyCtrl}/peer`         — WRITE a node_claim/release to
//     another same-site controller's actuators.
//   - `majiflow/{site}/{anyCtrl}/telemetry|status` — READ another same-site
//     controller's published values (the remote level/flow read-import).
// Everything else stays locked down. Cross-site access is never allowed.
func (h *deviceAuthHook) OnACLCheck(cl *mqtt.Client, topic string, write bool) bool {
	deviceID := string(cl.Properties.Username)
	if deviceID == "" {
		return false
	}
	parts := strings.Split(topic, "/")
	if len(parts) < 3 || parts[0] != "majiflow" {
		return false
	}
	// Own namespace — always allowed (includes the device's own .../peer, which
	// it subscribes to).
	if parts[2] == deviceID {
		return true
	}
	// Cross-controller lanes — same site only.
	if len(parts) >= 4 {
		switch parts[3] {
		case "peer":
			// Claim/release another controller's actuators (write).
			return h.sameSite(deviceID, parts[1])
		case "telemetry", "status":
			// Read another controller's outputs; never write into them.
			return !write && h.sameSite(deviceID, parts[1])
		}
	}
	return false
}

// sameSite reports whether deviceID's controller belongs to the given site.
func (h *deviceAuthHook) sameSite(deviceID, site string) bool {
	rec, err := h.app.FindFirstRecordByFilter(
		"controllers", "device_id = {:d}", dbx.Params{"d": deviceID},
	)
	if err != nil || rec == nil {
		return false
	}
	return rec.GetString("site") == site
}
