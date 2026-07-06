package migrations

import (
	"github.com/pocketbase/pocketbase/core"
	m "github.com/pocketbase/pocketbase/migrations"
)

// Contact phone for account profiles. Updated through /api/farmon/account so
// the users collection can stay admin-only for writes (role stays protected).
func init() {
	m.Register(func(app core.App) error {
		c, err := app.FindCollectionByNameOrId("users")
		if err != nil {
			return err
		}
		if c.Fields.GetByName("phone") == nil {
			c.Fields.Add(&core.TextField{Name: "phone", Max: 60})
			if err := app.Save(c); err != nil {
				return err
			}
		}

		prefs, err := app.FindAllRecords("notification_prefs")
		if err != nil {
			return err
		}
		for _, pref := range prefs {
			phone := normalizeMigrationPhone(pref.GetString("whatsapp_chat_id"))
			if phone == "" {
				continue
			}
			userID := pref.GetString("user")
			if userID == "" {
				continue
			}
			user, err := app.FindRecordById("users", userID)
			if err != nil || user.GetString("phone") != "" {
				continue
			}
			user.Set("phone", phone)
			if err := app.Save(user); err != nil {
				return err
			}
		}
		return app.Save(c)
	}, func(app core.App) error {
		c, err := app.FindCollectionByNameOrId("users")
		if err != nil {
			return err
		}
		c.Fields.RemoveByName("phone")
		return app.Save(c)
	})
}

func normalizeMigrationPhone(raw string) string {
	chatID := normalizeMigrationWhatsAppChatID(raw)
	if chatID == "" {
		return ""
	}
	digits := migrationNonDigit.ReplaceAllString(chatID, "")
	if digits == "" {
		return ""
	}
	return "+" + digits
}
