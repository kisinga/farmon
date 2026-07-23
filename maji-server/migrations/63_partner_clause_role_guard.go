package migrations

import (
	"strings"

	"github.com/pocketbase/pocketbase/core"
	m "github.com/pocketbase/pocketbase/migrations"
	"github.com/pocketbase/pocketbase/tools/types"
)

// Restricts the org-scoping clause introduced by 55 (and extended by 61/62) to
// partner-role callers. The clause `@request.auth.partner != "" && <rel> ?= @request.auth.partner`
// matched ANY authenticated user whose partner field is set — and customers carry
// their org in users.partner too, so a customer could list every site (and every
// site child: controllers, telemetry, incidents, automations, …) belonging to
// their organization, not just the ones they own. requireSiteAccess has always
// required role=partner for the same grant; this aligns the collection rules
// with it. The change only ever REMOVES access (customers keep their owner
// clause; partners and admins are unaffected).
func init() {
	unguarded := `(@request.auth.partner != "" &&`
	guarded := `(@request.auth.role = "partner" && @request.auth.partner != "" &&`

	rewrite := func(app core.App, from, to string) error {
		cols, err := app.FindAllCollections()
		if err != nil {
			return err
		}
		for _, c := range cols {
			changed := false
			for _, rule := range []**string{&c.ListRule, &c.ViewRule, &c.CreateRule, &c.UpdateRule, &c.DeleteRule} {
				if *rule == nil || !strings.Contains(**rule, from) {
					continue
				}
				*rule = types.Pointer(strings.ReplaceAll(**rule, from, to))
				changed = true
			}
			if changed {
				if err := app.Save(c); err != nil {
					return err
				}
			}
		}
		return nil
	}

	m.Register(func(app core.App) error {
		return rewrite(app, unguarded, guarded)
	}, func(app core.App) error {
		return rewrite(app, guarded, unguarded)
	})
}
