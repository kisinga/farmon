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

// ingestHook persists telemetry published to
// `majiflow/{site}/{ctrl}/telemetry/{sensor}` (local-first) and marks the
// controller online. Non-telemetry topics pass through untouched.
type ingestHook struct {
	mqtt.HookBase
	app core.App
}

func (h *ingestHook) ID() string { return "maji-ingest" }

func (h *ingestHook) Provides(b byte) bool { return b == mqtt.OnPublish }

func (h *ingestHook) OnPublish(cl *mqtt.Client, pk packets.Packet) (packets.Packet, error) {
	site, ctrl, sensor, ok := telemetry.ParseTopic(pk.TopicName)
	if !ok {
		return pk, nil
	}
	value, err := strconv.ParseFloat(strings.TrimSpace(string(pk.Payload)), 64)
	if err != nil {
		return pk, nil // ignore non-numeric payloads
	}
	_ = telemetry.Ingest(h.app, telemetry.Reading{
		Site:   site,
		Ctrl:   ctrl,
		Sensor: sensor,
		Value:  value,
		TS:     time.Now(),
	})
	return pk, nil
}
