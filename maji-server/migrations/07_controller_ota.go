package migrations

import (
	"github.com/pocketbase/pocketbase/core"
	m "github.com/pocketbase/pocketbase/migrations"
)

// Controllers gain a stable, server-managed `ota_password`. The OTA auth secret
// must persist across firmware rebuilds — ESPHome OTA compares the new build's
// password against the password the running device already holds — so it is
// generated once at first provision and reused on every later build. Stored raw
// + hidden: it is ours (like the MQTT token), but unlike the token the firmware
// needs the literal value baked into each build, so we keep the value, not a hash.
func init() {
	m.Register(func(app core.App) error {
		c, err := app.FindCollectionByNameOrId("controllers")
		if err != nil {
			return err
		}
		c.Fields.Add(&core.TextField{Name: "ota_password", Max: 200, Hidden: true})
		return app.Save(c)
	}, func(app core.App) error {
		c, err := app.FindCollectionByNameOrId("controllers")
		if err != nil {
			return err
		}
		c.Fields.RemoveByName("ota_password")
		return app.Save(c)
	})
}
