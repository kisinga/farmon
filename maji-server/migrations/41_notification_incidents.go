package migrations

import (
	"github.com/pocketbase/pocketbase/core"
	m "github.com/pocketbase/pocketbase/migrations"
	"github.com/pocketbase/pocketbase/tools/types"
)

// notification_incidents is the small persistent dedupe ledger for external
// notifications. Alert conditions are still derived from runtime state; this table
// only remembers whether the current incident episode was already sent.
func init() {
	m.Register(func(app core.App) error {
		adminOnly := types.Pointer(`@request.auth.role = "admin"`)
		adminOrSiteOwner := types.Pointer(`@request.auth.id != "" && (@request.auth.role = "admin" || site.owner.id ?= @request.auth.id)`)

		sites, err := app.FindCollectionByNameOrId("sites")
		if err != nil {
			return err
		}

		c := core.NewBaseCollection("notification_incidents")
		c.Fields.Add(
			&core.RelationField{Name: "site", CollectionId: sites.Id, MaxSelect: 1, Required: true, CascadeDelete: true},
			&core.TextField{Name: "incident_key", Required: true, Max: 220},
			&core.SelectField{Name: "kind", MaxSelect: 1, Required: true, Values: []string{"device_offline", "fault", "tank_low", "tank_high"}},
			&core.SelectField{Name: "status", MaxSelect: 1, Required: true, Values: []string{"active", "resolved"}},
			&core.TextField{Name: "subject", Max: 160},
			&core.TextField{Name: "body", Max: 600},
			&core.TextField{Name: "first_seen", Max: 40},
			&core.TextField{Name: "last_seen", Max: 40},
			&core.TextField{Name: "last_sent", Max: 40},
			&core.TextField{Name: "resolved_at", Max: 40},
			&core.AutodateField{Name: "created", OnCreate: true},
			&core.AutodateField{Name: "updated", OnCreate: true, OnUpdate: true},
		)
		c.AddIndex("idx_notification_incidents_key", true, "incident_key", "")
		c.AddIndex("idx_notification_incidents_site", false, "site,status,last_seen", "")
		c.ListRule = adminOrSiteOwner
		c.ViewRule = adminOrSiteOwner
		c.CreateRule = adminOnly
		c.UpdateRule = adminOnly
		c.DeleteRule = adminOnly
		return app.Save(c)
	}, func(app core.App) error {
		if c, err := app.FindCollectionByNameOrId("notification_incidents"); err == nil {
			return app.Delete(c)
		}
		return nil
	})
}
