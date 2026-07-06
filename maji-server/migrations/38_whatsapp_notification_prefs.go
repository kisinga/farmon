package migrations

import (
	"github.com/pocketbase/pocketbase/core"
	m "github.com/pocketbase/pocketbase/migrations"
)

// WhatsApp notification channel. OpenWA is configured by environment on the
// server; each user controls whether alerts route there and which WhatsApp chat
// id receives them.
func init() {
	m.Register(func(app core.App) error {
		c, err := app.FindCollectionByNameOrId("notification_prefs")
		if err != nil {
			return err
		}
		if c.Fields.GetByName("channel_whatsapp") == nil {
			c.Fields.Add(&core.BoolField{Name: "channel_whatsapp"})
		}
		if c.Fields.GetByName("whatsapp_chat_id") == nil {
			c.Fields.Add(&core.TextField{Name: "whatsapp_chat_id", Max: 100})
		}
		return app.Save(c)
	}, func(app core.App) error {
		c, err := app.FindCollectionByNameOrId("notification_prefs")
		if err != nil {
			return err
		}
		c.Fields.RemoveByName("channel_whatsapp")
		c.Fields.RemoveByName("whatsapp_chat_id")
		return app.Save(c)
	})
}
