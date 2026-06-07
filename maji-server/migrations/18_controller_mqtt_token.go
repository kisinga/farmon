package migrations

import (
	"github.com/pocketbase/pocketbase/core"
	m "github.com/pocketbase/pocketbase/migrations"
)

// Controllers gain a stable, server-managed `mqtt_token` (raw, hidden). The MQTT
// token must persist across firmware rebuilds: the broker authenticates a device
// by the password it was flashed with, so re-minting on every build locks out an
// already-flashed device. Like `ota_password`, it is generated once at first
// provision and reused on later builds (only an explicit rotate replaces it); the
// firmware bakes the literal value, so we keep the value, with `token_hash` —
// what the broker verifies against — held in lockstep.
//
// Pre-existing controllers have only a `token_hash` (the raw token was never
// stored), so `mqtt_token` starts empty for them; their next provision mints one
// fresh token and from then on it is stable.
func init() {
	m.Register(func(app core.App) error {
		c, err := app.FindCollectionByNameOrId("controllers")
		if err != nil {
			return err
		}
		c.Fields.Add(&core.TextField{Name: "mqtt_token", Max: 200, Hidden: true})
		return app.Save(c)
	}, func(app core.App) error {
		c, err := app.FindCollectionByNameOrId("controllers")
		if err != nil {
			return err
		}
		c.Fields.RemoveByName("mqtt_token")
		return app.Save(c)
	})
}
