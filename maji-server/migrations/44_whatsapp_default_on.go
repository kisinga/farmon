package migrations

import (
	"strings"

	"github.com/pocketbase/pocketbase/core"
	m "github.com/pocketbase/pocketbase/migrations"
)

// WhatsApp alerts become the default external channel. For every existing
// notification_prefs row that has a usable number (stored chat id or a profile
// phone), turn the channel on and copy the profile phone into the chat id field
// when no dedicated chat id is present.
func init() {
	m.Register(func(app core.App) error {
		prefs, err := app.FindAllRecords("notification_prefs")
		if err != nil {
			return err
		}
		for _, rec := range prefs {
			chatID := strings.TrimSpace(rec.GetString("whatsapp_chat_id"))
			if chatID == "" {
				userID := rec.GetString("user")
				if userID != "" {
					if user, err := app.FindRecordById("users", userID); err == nil {
						phone := normalizeMigrationWhatsAppChatID(user.GetString("phone"))
						if phone != "" {
							chatID = phone
							rec.Set("whatsapp_chat_id", chatID)
						}
					}
				}
			}
			if chatID != "" {
				rec.Set("channel_whatsapp", true)
			}
			if err := app.Save(rec); err != nil {
				return err
			}
		}
		return nil
	}, func(app core.App) error {
		// Downgrade is intentionally a no-op: we do not know which users had the
		// channel explicitly off before this migration.
		return nil
	})
}
