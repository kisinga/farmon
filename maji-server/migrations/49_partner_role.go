package migrations

import (
	"strings"

	"github.com/pocketbase/pocketbase/core"
	m "github.com/pocketbase/pocketbase/migrations"
	"github.com/pocketbase/pocketbase/tools/types"
)

// Adds a partner tier between admin and customer:
//   - users.role gains "partner"
//   - users.partner relation points a customer at their partner (nullable)
//   - sites.partner relation mirrors the partner(s) of the site's owners so RBAC
//     can scope partner access without nested multi-relation rule paths.
//   - collection rules are widened so partners see/manage their own customers
//     and those customers' sites/devices/telemetry.
func init() {
	m.Register(func(app core.App) error {
		users, err := app.FindCollectionByNameOrId("users")
		if err != nil {
			return err
		}

		// 1. Add "partner" to the role select.
		if role, ok := users.Fields.GetByName("role").(*core.SelectField); ok {
			has := false
			for _, v := range role.Values {
				if v == "partner" {
					has = true
					break
				}
			}
			if !has {
				role.Values = append(role.Values, "partner")
			}
		}

		// 2. Add a nullable relation from a customer to their partner.
		if users.Fields.GetByName("partner") == nil {
			users.Fields.Add(&core.RelationField{
				Name:         "partner",
				CollectionId: users.Id,
				MaxSelect:    1,
			})
		}

		if err := app.Save(users); err != nil {
			return err
		}

		// 3. Add a partner relation to sites (denormalized from owners).
		sites, err := app.FindCollectionByNameOrId("sites")
		if err != nil {
			return err
		}
		if sites.Fields.GetByName("partner") == nil {
			sites.Fields.Add(&core.RelationField{
				Name:         "partner",
				CollectionId: users.Id,
				MaxSelect:    50,
			})
		}
		if err := app.Save(sites); err != nil {
			return err
		}

		// 4. Widen collection rules for partner scoping.
		cols, err := app.FindAllCollections()
		if err != nil {
			return err
		}

		for _, c := range cols {
			changed := false
			hasOwner := c.Fields.GetByName("owner") != nil
			hasPartner := c.Fields.GetByName("partner") != nil
			hasSite := c.Fields.GetByName("site") != nil

			for _, rule := range []**string{&c.ListRule, &c.ViewRule, &c.CreateRule, &c.UpdateRule, &c.DeleteRule} {
				if *rule == nil {
					continue
				}
				r := **rule
				newR := r
				if hasOwner && hasPartner {
					newR = strings.ReplaceAll(newR,
						"owner.id ?= @request.auth.id",
						"owner.id ?= @request.auth.id || partner.id ?= @request.auth.id")
				}
				if hasSite {
					newR = strings.ReplaceAll(newR,
						"site.owner.id ?= @request.auth.id",
						"site.owner.id ?= @request.auth.id || site.partner.id ?= @request.auth.id")
				}
				if newR != r {
					*rule = types.Pointer(newR)
					changed = true
				}
			}

			// users needs explicit read/create/update/delete rules.
			if c.Name == "users" {
				c.ListRule = types.Pointer(`@request.auth.id != "" && (@request.auth.role = "admin" || id = @request.auth.id || partner = @request.auth.id || sites_via_owner.owner.id ?= @request.auth.id)`)
				c.ViewRule = c.ListRule
				c.CreateRule = types.Pointer(`@request.auth.role = "admin" || (@request.auth.role = "partner" && role = "customer" && partner = @request.auth.id)`)
				c.UpdateRule = types.Pointer(`@request.auth.role = "admin" || id = @request.auth.id || (@request.auth.role = "partner" && partner = @request.auth.id)`)
				c.DeleteRule = types.Pointer(`@request.auth.role = "admin" || (@request.auth.role = "partner" && partner = @request.auth.id)`)
				changed = true
			}

			if changed {
				if err := app.Save(c); err != nil {
					return err
				}
			}
		}

		return nil
	}, func(app core.App) error {
		// Down is intentionally limited: removing a role value or relation while
		// live data may reference it is risky. Restore manually if needed.
		return nil
	})
}
