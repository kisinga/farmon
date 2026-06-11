package migrations

import (
	"github.com/pocketbase/pocketbase/core"
	m "github.com/pocketbase/pocketbase/migrations"
)

// Controllers gain a hardware-identity tripwire. A controller's identity (MQTT
// username + baked token, topics, name) is fixed at firmware build time, so the
// same .bin flashed to two boards makes both claim one identity — the broker
// can't tell them apart (same valid token). `first_mac` binds the controller to
// the chip MAC of the first board to connect; a later board reporting a different
// MAC sets `mac_conflict` + `conflict_mac`. Detection only (both hold the valid
// token, so we flag + alert, never disconnect); an admin rebind clears first_mac.
//
// Not hidden: the dashboard reads `mac_conflict`/`conflict_mac` to badge the clash.
func init() {
	m.Register(func(app core.App) error {
		c, err := app.FindCollectionByNameOrId("controllers")
		if err != nil {
			return err
		}
		c.Fields.Add(&core.TextField{Name: "first_mac", Max: 32})
		c.Fields.Add(&core.BoolField{Name: "mac_conflict"})
		c.Fields.Add(&core.TextField{Name: "conflict_mac", Max: 32})
		return app.Save(c)
	}, func(app core.App) error {
		c, err := app.FindCollectionByNameOrId("controllers")
		if err != nil {
			return err
		}
		c.Fields.RemoveByName("first_mac")
		c.Fields.RemoveByName("mac_conflict")
		c.Fields.RemoveByName("conflict_mac")
		return app.Save(c)
	})
}
