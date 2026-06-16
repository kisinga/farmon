package migrations

import (
	"github.com/pocketbase/pocketbase/core"
	m "github.com/pocketbase/pocketbase/migrations"
	"github.com/pocketbase/pocketbase/tools/types"
)

// `packs` is the entitlement catalog: each pack bundles capability keys, the widget
// ids those capabilities light up, and a price. A site's feature set is computed
// (CORE ∪ packs.capabilities ∪ site.addons) — packs are the only paid lever that
// grants features. Like `boards`, the catalog is admin-managed domain data: any
// authed user may read it, only admins mutate it. Adding or pricing a pack is a
// data edit, not a code change.
//
// `sites.packs` records what a site has bought. A customer must not self-grant it
// (the site UpdateRule lets an owner edit their own site), so writes to it are
// blocked for non-admins in registerSiteHooks (guardEntitlementWrite).
func init() {
	m.Register(func(app core.App) error {
		authed := types.Pointer(`@request.auth.id != ""`)
		adminOnly := types.Pointer(`@request.auth.role = "admin"`)

		packs := core.NewBaseCollection("packs")
		packs.Fields.Add(
			&core.TextField{Name: "key", Required: true, Max: 100},
			&core.TextField{Name: "label", Max: 200},
			// Optional segment the pack is pitched to (empty = universal). Surfaces the
			// pack in onboarding/estimator; never restricts who may buy it.
			&core.SelectField{Name: "segment", Values: []string{"farm", "property", "water_supply"}, MaxSelect: 1},
			&core.JSONField{Name: "capabilities", MaxSize: 100_000},
			&core.JSONField{Name: "widget_ids", MaxSize: 100_000},
			&core.JSONField{Name: "automation_templates", MaxSize: 1_000_000},
			&core.NumberField{Name: "price_monthly"},
			&core.AutodateField{Name: "created", OnCreate: true},
			&core.AutodateField{Name: "updated", OnCreate: true, OnUpdate: true},
		)
		packs.AddIndex("idx_packs_key", true, "key", "")
		packs.ListRule = authed
		packs.ViewRule = authed
		packs.CreateRule = adminOnly
		packs.UpdateRule = adminOnly
		packs.DeleteRule = adminOnly
		if err := app.Save(packs); err != nil {
			return err
		}

		// Multi-relation, no cascade: removing a pack from the catalog must not delete
		// the sites that hold it.
		sites, err := app.FindCollectionByNameOrId("sites")
		if err != nil {
			return err
		}
		sites.Fields.Add(
			&core.RelationField{Name: "packs", CollectionId: packs.Id, MaxSelect: 50},
		)
		return app.Save(sites)
	}, func(app core.App) error {
		// Drop the relation before the collection it points at.
		if sites, err := app.FindCollectionByNameOrId("sites"); err == nil {
			sites.Fields.RemoveByName("packs")
			if err := app.Save(sites); err != nil {
				return err
			}
		}
		if c, err := app.FindCollectionByNameOrId("packs"); err == nil {
			return app.Delete(c)
		}
		return nil
	})
}
