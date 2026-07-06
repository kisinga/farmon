package migrations

import (
	"regexp"
	"strings"

	"github.com/pocketbase/pocketbase/core"
	m "github.com/pocketbase/pocketbase/migrations"
)

const defaultWhatsAppCountryCode = "254"

var migrationNonDigit = regexp.MustCompile(`\D+`)

// Adds a country-code context for WhatsApp phone normalisation. Existing rows
// predate the selector, so treat every saved WhatsApp number as Kenyan and
// rewrite it to the OpenWA chat-id form.
func init() {
	m.Register(func(app core.App) error {
		c, err := app.FindCollectionByNameOrId("notification_prefs")
		if err != nil {
			return err
		}
		if c.Fields.GetByName("whatsapp_country_code") == nil {
			c.Fields.Add(&core.TextField{Name: "whatsapp_country_code", Max: 8})
			if err := app.Save(c); err != nil {
				return err
			}
		}

		records, err := app.FindAllRecords("notification_prefs")
		if err != nil {
			return err
		}
		for _, rec := range records {
			rec.Set("whatsapp_country_code", defaultWhatsAppCountryCode)
			if chatID := normalizeMigrationWhatsAppChatID(rec.GetString("whatsapp_chat_id")); chatID != "" {
				rec.Set("whatsapp_chat_id", chatID)
			}
			if err := app.Save(rec); err != nil {
				return err
			}
		}
		return nil
	}, func(app core.App) error {
		c, err := app.FindCollectionByNameOrId("notification_prefs")
		if err != nil {
			return err
		}
		c.Fields.RemoveByName("whatsapp_country_code")
		return app.Save(c)
	})
}

func normalizeMigrationWhatsAppChatID(raw string) string {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return ""
	}
	if strings.Contains(raw, "@") {
		raw = strings.TrimSuffix(raw, "@c.us")
		raw = strings.TrimSuffix(raw, "@s.whatsapp.net")
	}
	digits := migrationNonDigit.ReplaceAllString(raw, "")
	digits = strings.TrimPrefix(digits, "00")
	if digits == "" {
		return ""
	}
	if strings.HasPrefix(digits, defaultWhatsAppCountryCode) {
		return digits + "@c.us"
	}
	if strings.HasPrefix(digits, "0") {
		return defaultWhatsAppCountryCode + strings.TrimLeft(digits, "0") + "@c.us"
	}
	return defaultWhatsAppCountryCode + digits + "@c.us"
}
