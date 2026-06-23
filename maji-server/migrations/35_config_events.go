package migrations

import (
	"github.com/pocketbase/pocketbase/core"
	m "github.com/pocketbase/pocketbase/migrations"
	"github.com/pocketbase/pocketbase/tools/types"
)

// config_events: an append-only log of operator configuration changes that do NOT
// flow through POST /command — today, automation create/edit/enable/disable/delete.
// It's the third source of the dashboard Activity timeline (alongside state_events
// and commands), so editing an automation leaves a visible, attributed history entry.
//
// The `automations` collection is mutable CRUD (last-write-wins; a delete removes the
// row), so its changes can't be reconstructed from it after the fact — they must be
// recorded as events at write time. Written server-side from the automations request
// hooks (automations.RegisterActivity), which stamp the acting user; clients never
// write it (Create/Update/Delete admin-only, bypassed by the server's app.Save).
//
// `automation` is a plain text id (not a relation) so a "removed" event survives the
// deletion of the automation it refers to. `actor` is the acting user id (text, not a
// users relation) so a PocketBase superuser acting directly never trips relation
// validation; the dashboard resolves it to a name through the same people directory
// that labels commands and transitions.
func init() {
	m.Register(func(app core.App) error {
		adminOrSiteOwner := types.Pointer(`@request.auth.id != "" && (@request.auth.role = "admin" || site.owner = @request.auth.id)`)
		adminOnly := types.Pointer(`@request.auth.role = "admin"`)

		sites, err := app.FindCollectionByNameOrId("sites")
		if err != nil {
			return err
		}
		controllers, err := app.FindCollectionByNameOrId("controllers")
		if err != nil {
			return err
		}

		c := core.NewBaseCollection("config_events")
		c.Fields.Add(
			&core.RelationField{Name: "site", CollectionId: sites.Id, MaxSelect: 1, Required: true, CascadeDelete: true},
			&core.RelationField{Name: "controller", CollectionId: controllers.Id, MaxSelect: 1, CascadeDelete: true},
			&core.TextField{Name: "actor", Max: 100},
			&core.TextField{Name: "issued_role", Max: 20},
			&core.TextField{Name: "automation", Max: 100},
			&core.TextField{Name: "name", Max: 120},
			&core.SelectField{Name: "change", MaxSelect: 1, Required: true, Values: []string{"added", "edited", "enabled", "disabled", "removed"}},
			&core.TextField{Name: "ts", Max: 40},
			&core.AutodateField{Name: "created", OnCreate: true},
		)
		c.AddIndex("idx_config_events_timeline", false, "site,controller,ts", "")
		c.ListRule = adminOrSiteOwner
		c.ViewRule = adminOrSiteOwner
		c.CreateRule = adminOnly
		c.UpdateRule = adminOnly
		c.DeleteRule = adminOnly
		return app.Save(c)
	}, func(app core.App) error {
		if c, err := app.FindCollectionByNameOrId("config_events"); err == nil {
			return app.Delete(c)
		}
		return nil
	})
}
