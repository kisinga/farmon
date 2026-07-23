package migrations

import (
	"github.com/pocketbase/pocketbase/core"
	m "github.com/pocketbase/pocketbase/migrations"
	"github.com/pocketbase/pocketbase/tools/types"
)

// dashboard_layouts stores per-site dashboard layout blobs for the dashboard
// rework. Rows are keyed (key, site, user): a row with an empty user is the
// shared site/key default (written by a site owner), a row with a user is that
// user's personal override. Reads follow the standard site-child RBAC (owner,
// admin, or partner of the site — the post-26/49/55 automations idiom); writes
// are narrower: admins always, per-user rows only for their own user on a site
// they can read, shared-default rows only for site owners.
func init() {
	m.Register(func(app core.App) error {
		readRule := types.Pointer(`@request.auth.id != "" && (@request.auth.role = "admin" || site.owner.id ?= @request.auth.id || (@request.auth.partner != "" && site.partner.id ?= @request.auth.partner))`)
		writeRule := types.Pointer(`@request.auth.id != "" && (@request.auth.role = "admin" || (user = @request.auth.id && (site.owner.id ?= @request.auth.id || (@request.auth.partner != "" && site.partner.id ?= @request.auth.partner))) || (user = "" && site.owner.id ?= @request.auth.id))`)

		sites, err := app.FindCollectionByNameOrId("sites")
		if err != nil {
			return err
		}
		users, err := app.FindCollectionByNameOrId("users")
		if err != nil {
			return err
		}

		c := core.NewBaseCollection("dashboard_layouts")
		c.Fields.Add(
			// Layout profile, e.g. "site-dashboard". (PocketBase v0.39 text fields
			// have no default-value support; clients send the key explicitly.)
			&core.TextField{Name: "key", Required: true, Max: 80},
			// Optional like other site children added after multi-owner; cascade so
			// removing a site clears its layouts (mirrors the automations relation).
			&core.RelationField{Name: "site", CollectionId: sites.Id, MaxSelect: 1, CascadeDelete: true},
			// Empty = shared site/key default; set = that user's personal override.
			// Cascade so removing a user clears their personal layouts.
			&core.RelationField{Name: "user", CollectionId: users.Id, MaxSelect: 1, CascadeDelete: true},
			&core.JSONField{Name: "layout", MaxSize: 100_000},
			&core.AutodateField{Name: "created", OnCreate: true},
			&core.AutodateField{Name: "updated", OnCreate: true, OnUpdate: true},
		)
		// One row per (key, site, user): a personal override replaces, never stacks.
		c.AddIndex("idx_dashboard_layouts_key_site_user", true, "key,site,user", "")
		c.ListRule = readRule
		c.ViewRule = readRule
		c.CreateRule = writeRule
		c.UpdateRule = writeRule
		c.DeleteRule = writeRule
		return app.Save(c)
	}, func(app core.App) error {
		c, err := app.FindCollectionByNameOrId("dashboard_layouts")
		if err != nil {
			return nil // already gone
		}
		return app.Delete(c)
	})
}
