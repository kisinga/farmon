package mqtt

import (
	"strings"
	"time"

	"github.com/kisinga/majiflow/internal/telemetry"
	mqtt "github.com/mochi-mqtt/server/v2"
	"github.com/mochi-mqtt/server/v2/packets"
	"github.com/pocketbase/pocketbase/core"
)

// ingestHook persists everything devices publish under `majiflow/{site}/{ctrl}/…`
// (local-first) and tracks online/offline. It routes by topic:
//   - state    → project the controller snapshot (the single source of truth):
//                raw history + shadow + derived timeline + command reconcile
//   - status  ("1")               → controller online (retained birth)
//   - identity (chip MAC)         → bind/flag hardware (duplicate-firmware tripwire)
// Anything else passes through untouched.
//
// Offline is NOT driven by the status topic: a device's Last-Will ("0") is published
// by Mochi via publishToSubscribers, which bypasses OnPublish, so the will never
// reaches this hook. The broker's OnDisconnect (below) flips the flag instead.
type ingestHook struct {
	mqtt.HookBase
	app core.App
}

func (h *ingestHook) ID() string { return "maji-ingest" }

func (h *ingestHook) Provides(b byte) bool {
	return b == mqtt.OnPublish || b == mqtt.OnDisconnect
}

// OnDisconnect marks the controller offline when the broker loses its connection
// (the only reliable offline signal — see SetOffline). A reconnect "takes over" the
// old session and fires this for the now-orphaned one; the device is already live on
// the new connection (its birth re-set online=true), so skip the takeover case to
// avoid flapping a freshly-reconnected device back to offline.
func (h *ingestHook) OnDisconnect(cl *mqtt.Client, _ error, _ bool) {
	if cl.IsTakenOver() {
		return
	}
	// Username == device_id == controller id (see deviceAuthHook).
	_ = telemetry.SetOffline(h.app, string(cl.Properties.Username))
}

func (h *ingestHook) OnPublish(cl *mqtt.Client, pk packets.Packet) (packets.Packet, error) {
	topic := pk.TopicName
	now := time.Now()

	if site, ctrl, ok := telemetry.ParseSnapshotTopic(topic); ok {
		// The single source of truth: project the snapshot into raw history, the
		// shadow, the derived timeline, and command reconciliation.
		_ = telemetry.IngestSnapshot(h.app, site, ctrl, pk.Payload, now)
		return pk, nil
	}

	if _, ctrl, ok := telemetry.ParseStatusTopic(topic); ok {
		_ = telemetry.SetOnline(h.app, ctrl, strings.TrimSpace(string(pk.Payload)) == "1", now)
		return pk, nil
	}

	if _, ctrl, ok := telemetry.ParseIdentityTopic(topic); ok {
		// Retained chip MAC: bind on first connect, flag a different board on the same
		// identity (duplicate-firmware tripwire). Detection only, never disconnects.
		_ = telemetry.BindOrCheckMac(h.app, ctrl, string(pk.Payload))
		return pk, nil
	}

	return pk, nil
}
