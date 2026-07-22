package alerts

import (
	"fmt"
	"net/http"
	"strings"

	"github.com/pocketbase/pocketbase/core"
)

// SendExternal delivers a one-off notification to arbitrary recipients (as
// opposed to the sweeper's owner-scoped incidents) — used by the billing
// module for tenant-facing arrears notices. Channels are best-effort and
// skip silently when their infrastructure is unconfigured (SMTP / OpenWA);
// a channel that IS configured but fails contributes to the returned error.
func SendExternal(app core.App, emails []string, whatsappPhones []string, subject, body string) error {
	s := &sweeper{openwa: openWAFromEnv(http.DefaultClient)}
	var errs []string

	if len(emails) > 0 && app.Settings().SMTP.Enabled {
		if err := s.sendEmail(app, emails, "", subject, body); err != nil {
			errs = append(errs, "email: "+err.Error())
		}
	}
	if len(whatsappPhones) > 0 && s.openwa.configured() {
		chatIDs := make([]string, 0, len(whatsappPhones))
		for _, p := range whatsappPhones {
			if id := normalizeWhatsAppChatID(p, ""); id != "" {
				chatIDs = append(chatIDs, id)
			}
		}
		if len(chatIDs) > 0 {
			if err := s.sendWhatsApp(chatIDs, "", subject, body); err != nil {
				errs = append(errs, "whatsapp: "+err.Error())
			}
		}
	}
	if len(errs) > 0 {
		return fmt.Errorf("%s", strings.Join(errs, "; "))
	}
	return nil
}
