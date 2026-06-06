package migrations

import (
	"github.com/pocketbase/pocketbase/core"
	m "github.com/pocketbase/pocketbase/migrations"
)

// Sites gain a per-site `udp_key`: the shared secret that authenticates
// cross-controller coordination over the LAN UDP lane (HMAC over claims/readings).
// It is per-SITE (every controller on the site shares it, unlike the per-controller
// MQTT token / OTA password) and minted once at first provision, then reused so the
// whole site keeps the same key. Stored raw + hidden — the firmware bakes the literal
// value into each controller's secrets.yaml.
func init() {
	m.Register(func(app core.App) error {
		c, err := app.FindCollectionByNameOrId("sites")
		if err != nil {
			return err
		}
		c.Fields.Add(&core.TextField{Name: "udp_key", Max: 200, Hidden: true})
		return app.Save(c)
	}, func(app core.App) error {
		c, err := app.FindCollectionByNameOrId("sites")
		if err != nil {
			return err
		}
		c.Fields.RemoveByName("udp_key")
		return app.Save(c)
	})
}
