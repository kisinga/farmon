package migrations

import (
	"github.com/pocketbase/pocketbase/core"
	m "github.com/pocketbase/pocketbase/migrations"
)

// Leads gain marketing-attribution fields: the UTM tags from the link that
// brought the visitor in, plus the landing page and referrer captured on
// first touch. All optional — organic/direct traffic leaves them blank, and
// the browser only ever writes them at lead-create time (public create rule).
func init() {
	m.Register(func(app core.App) error {
		c, err := app.FindCollectionByNameOrId("leads")
		if err != nil {
			return err
		}
		c.Fields.Add(
			&core.TextField{Name: "utm_source", Max: 120},
			&core.TextField{Name: "utm_medium", Max: 120},
			&core.TextField{Name: "utm_campaign", Max: 120},
			&core.TextField{Name: "utm_content", Max: 120},
			&core.TextField{Name: "utm_term", Max: 120},
			&core.TextField{Name: "landing_page", Max: 300},
			&core.TextField{Name: "referrer", Max: 300},
		)
		return app.Save(c)
	}, func(app core.App) error {
		c, err := app.FindCollectionByNameOrId("leads")
		if err != nil {
			return err
		}
		for _, f := range []string{"utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term", "landing_page", "referrer"} {
			c.Fields.RemoveByName(f)
		}
		return app.Save(c)
	})
}
