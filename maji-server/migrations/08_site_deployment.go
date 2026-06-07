package migrations

import (
	"github.com/pocketbase/pocketbase/core"
	m "github.com/pocketbase/pocketbase/migrations"
)

// Sites gain a per-site deployment choice: which MQTT broker the site's
// controllers connect to.
//
//   - mode:        "managed" (MajiFlow cloud) or "local" (an on-site box).
//                  Empty == not chosen yet; the app falls back to the server's
//                  build shape. Drives the cross-controller (cross-talk) check:
//                  managed forbids it, local allows it.
//   - broker_host/_port/_tls: the broker the firmware is baked to reach. For a
//     managed site these autofill from the cloud defaults (mqtt.majiflow.io:8883
//     TLS) and stay blank here; for a local site the installer sets the box's
//     LAN address.
func init() {
	m.Register(func(app core.App) error {
		c, err := app.FindCollectionByNameOrId("sites")
		if err != nil {
			return err
		}
		c.Fields.Add(
			&core.SelectField{Name: "mode", Values: []string{"managed", "local"}, MaxSelect: 1},
			&core.TextField{Name: "broker_host", Max: 200},
			&core.NumberField{Name: "broker_port"},
			&core.BoolField{Name: "broker_tls"},
		)
		return app.Save(c)
	}, func(app core.App) error {
		c, err := app.FindCollectionByNameOrId("sites")
		if err != nil {
			return err
		}
		c.Fields.RemoveByName("mode")
		c.Fields.RemoveByName("broker_host")
		c.Fields.RemoveByName("broker_port")
		c.Fields.RemoveByName("broker_tls")
		return app.Save(c)
	})
}
