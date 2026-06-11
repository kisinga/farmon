package mqtt

import (
	"strconv"
	"strings"
	"time"

	"github.com/kisinga/majiflow/internal/telemetry"
	mqtt "github.com/mochi-mqtt/server/v2"
	"github.com/mochi-mqtt/server/v2/packets"
	"github.com/pocketbase/pocketbase/core"
)

// ingestHook persists everything devices publish under `majiflow/{site}/{ctrl}/…`
// (local-first) and tracks online/offline. It routes by topic:
//   - telemetry/{sensor} numeric  → rollups + numeric shadow
//   - telemetry/{sensor} token    → text shadow (categorical, e.g. "RUNNING")
//   - event                       → append a transition to state_events
//   - status  ("1"/"0")           → controller online/offline
//   - identity (chip MAC)         → bind/flag hardware (duplicate-firmware tripwire)
// Anything else passes through untouched.
type ingestHook struct {
	mqtt.HookBase
	app core.App
}

func (h *ingestHook) ID() string { return "maji-ingest" }

func (h *ingestHook) Provides(b byte) bool { return b == mqtt.OnPublish }

func (h *ingestHook) OnPublish(cl *mqtt.Client, pk packets.Packet) (packets.Packet, error) {
	topic := pk.TopicName
	now := time.Now()

	if site, ctrl, sensor, ok := telemetry.ParseTopic(topic); ok {
		payload := strings.TrimSpace(string(pk.Payload))
		if v, err := strconv.ParseFloat(payload, 64); err == nil {
			_ = telemetry.Ingest(h.app, telemetry.Reading{
				Site: site, Ctrl: ctrl, Sensor: sensor, Value: v, TS: now,
			})
		} else if payload != "" {
			// Categorical channel (state token) — shadow only, no rollups.
			_ = telemetry.IngestString(h.app, site, ctrl, sensor, payload, now)
		}
		return pk, nil
	}

	if site, ctrl, ok := telemetry.ParseEventTopic(topic); ok {
		_ = telemetry.IngestEvent(h.app, site, ctrl, pk.Payload, now)
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
