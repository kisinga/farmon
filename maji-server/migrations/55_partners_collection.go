package migrations

import (
	"encoding/json"
	"errors"
	"regexp"
	"strings"

	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/core"
	m "github.com/pocketbase/pocketbase/migrations"
	"github.com/pocketbase/pocketbase/tools/types"
)

// Introduces a real `partners` organization entity.
//
// Before this migration "partner" was a single user with role=partner; customers
// pointed at that user via users.partner and sites.partner mirrored the partner
// user ids of the site's owners. After this migration users.partner and
// sites.partner both point at the `partners` collection, so multiple admins can
// belong to one partner organization and manage the same set of customer sites.
func init() {
	m.Register(func(app core.App) error {
		// 1. Snapshot current partner values before any schema change.
		allUsers, err := app.FindRecordsByFilter("users", "", "", 0, 0)
		if err != nil {
			return err
		}
		userPartnerOld := make(map[string]string, len(allUsers))
		for _, u := range allUsers {
			userPartnerOld[u.Id] = u.GetString("partner")
		}

		allSites, err := app.FindRecordsByFilter("sites", "", "", 0, 0)
		if err != nil {
			return err
		}
		sitePartnersOld := make(map[string][]string, len(allSites))
		for _, s := range allSites {
			sitePartnersOld[s.Id] = s.GetStringSlice("partner")
		}

		// 2. Create the partners collection.
		partners, err := ensurePartnersCollection(app)
		if err != nil {
			return err
		}

		// 3. Build a map from old partner-user ids to new partner-org ids.
		partnerUsers, err := app.FindRecordsByFilter("users", "role = 'partner'", "", 0, 0)
		if err != nil {
			return err
		}
		userToOrg := make(map[string]string, len(partnerUsers))
		for _, u := range partnerUsers {
			org, err := createPartnerForUser(app, partners, u)
			if err != nil {
				return err
			}
			userToOrg[u.Id] = org.Id
		}

		// 4. Clear existing partner values before changing the relation target.
		// PocketBase validates existing rows when a relation target changes, and the
		// old values are partner-user ids that won't exist in the new partners
		// collection. Raw SQL bypasses validation and avoids per-record re-validation.
		if _, err := app.DB().NewQuery("UPDATE users SET partner = ''").Execute(); err != nil {
			return err
		}
		if _, err := app.DB().NewQuery("UPDATE sites SET partner = '[]'").Execute(); err != nil {
			return err
		}

		// 5. Replace users.partner with a relation to partners.
		users, err := app.FindCollectionByNameOrId("users")
		if err != nil {
			return err
		}
		if err := replaceRelationField(users, "partner", partners.Id, 1); err != nil {
			return err
		}
		if err := app.Save(users); err != nil {
			return err
		}

		// 6. Write migrated user partner values.
		for _, u := range allUsers {
			var newPartner string
			if u.GetString("role") == "partner" {
				newPartner = userToOrg[u.Id]
			} else if old := userPartnerOld[u.Id]; old != "" {
				newPartner = userToOrg[old]
			}
			if newPartner == "" {
				continue
			}
			if _, err := app.DB().NewQuery("UPDATE users SET partner = {:p} WHERE id = {:id}").
				Bind(dbx.Params{"p": newPartner, "id": u.Id}).Execute(); err != nil {
				return err
			}
		}

		// 7. Replace sites.partner with a relation to partners (keep multi-select).
		sites, err := app.FindCollectionByNameOrId("sites")
		if err != nil {
			return err
		}
		if err := replaceRelationField(sites, "partner", partners.Id, 50); err != nil {
			return err
		}
		if err := app.Save(sites); err != nil {
			return err
		}

		// 8. Write migrated site partner values.
		for _, s := range allSites {
			oldPartners := sitePartnersOld[s.Id]
			if len(oldPartners) == 0 {
				continue
			}
			seen := make(map[string]struct{}, len(oldPartners))
			newPartners := make([]string, 0, len(oldPartners))
			for _, old := range oldPartners {
				orgID, ok := userToOrg[old]
				if !ok {
					continue
				}
				if _, done := seen[orgID]; done {
					continue
				}
				seen[orgID] = struct{}{}
				newPartners = append(newPartners, orgID)
			}
			if len(newPartners) == 0 {
				continue
			}
			raw, err := json.Marshal(newPartners)
			if err != nil {
				return err
			}
			if _, err := app.DB().NewQuery("UPDATE sites SET partner = {:p} WHERE id = {:id}").
				Bind(dbx.Params{"p": string(raw), "id": s.Id}).Execute(); err != nil {
				return err
			}
		}

		// 9. Rewrite collection rules to org-based partner scoping.
		return rewritePartnerRules(app)
	}, func(app core.App) error {
		// Down is intentionally unsupported: reverting would require mapping org ids
		// back to partner-user ids that no longer exist, and removing the partners
		// collection while users/sites still reference it is unsafe. Fail explicitly
		// so a rollback is not silently treated as successful.
		return errors.New("migration 55 cannot be safely rolled back; restore from a backup instead")
	})
}

func ensurePartnersCollection(app core.App) (*core.Collection, error) {
	c, err := app.FindCollectionByNameOrId("partners")
	if err == nil && c != nil {
		return c, nil
	}

	c = core.NewBaseCollection("partners")
	c.Fields.Add(
		&core.TextField{Name: "name", Required: true, Max: 200},
		&core.TextField{Name: "slug", Max: 200},
		&core.FileField{
			Name:      "logo",
			MaxSelect: 1,
			MaxSize:   2 * 1024 * 1024, // 2 MB
			MimeTypes: []string{"image/jpeg", "image/png", "image/svg+xml", "image/webp"},
		},
		&core.TextField{Name: "brand_primary", Max: 7, Pattern: `^#[0-9a-fA-F]{6}$`},
		&core.TextField{Name: "brand_accent", Max: 7, Pattern: `^#[0-9a-fA-F]{6}$`},
		&core.AutodateField{Name: "created", OnCreate: true},
		&core.AutodateField{Name: "updated", OnCreate: true, OnUpdate: true},
	)
	c.AddIndex("idx_partners_slug", true, "slug", "")
	c.ListRule = types.Pointer(`@request.auth.role = "admin"`)
	c.ViewRule = c.ListRule
	c.CreateRule = types.Pointer(`@request.auth.role = "admin"`)
	c.UpdateRule = types.Pointer(`@request.auth.role = "admin"`)
	c.DeleteRule = types.Pointer(`@request.auth.role = "admin"`)
	return c, app.Save(c)
}

func createPartnerForUser(app core.App, partners *core.Collection, u *core.Record) (*core.Record, error) {
	org := core.NewRecord(partners)
	name := strings.TrimSpace(u.GetString("name"))
	if name == "" {
		name = strings.Split(u.GetString("email"), "@")[0]
	}
	org.Set("name", name)
	org.Set("slug", uniqueSlug(app, slugify(name), u.Id))
	org.Set("brand_primary", "#22D3EE")
	org.Set("brand_accent", "#0369A1")
	return org, app.Save(org)
}

func replaceRelationField(collection *core.Collection, fieldName, targetCollectionID string, maxSelect int) error {
	collection.Fields.RemoveByName(fieldName)
	// Use a new field id so PocketBase doesn't treat this as a collectionId change
	// on the old relation (which ValidateSettings rejects).
	collection.Fields.Add(&core.RelationField{
		Id:           fieldName + "_org",
		Name:         fieldName,
		CollectionId: targetCollectionID,
		MaxSelect:    maxSelect,
	})
	return nil
}

func rewritePartnerRules(app core.App) error {
	cols, err := app.FindAllCollections()
	if err != nil {
		return err
	}

	for _, c := range cols {
		changed := false
		for _, rule := range []**string{&c.ListRule, &c.ViewRule, &c.CreateRule, &c.UpdateRule, &c.DeleteRule} {
			if *rule == nil {
				continue
			}
			r := **rule
			newR := r

			// Collections that have both owner and partner (i.e. sites).
			if c.Fields.GetByName("owner") != nil && c.Fields.GetByName("partner") != nil {
				newR = strings.ReplaceAll(newR,
					"owner.id ?= @request.auth.id || partner.id ?= @request.auth.id",
					"owner.id ?= @request.auth.id || (@request.auth.partner != \"\" && partner.id ?= @request.auth.partner)")
			}
			// Child collections that scope through a site relation.
			if c.Fields.GetByName("site") != nil {
				newR = strings.ReplaceAll(newR,
					"site.owner.id ?= @request.auth.id || site.partner.id ?= @request.auth.id",
					"site.owner.id ?= @request.auth.id || (@request.auth.partner != \"\" && site.partner.id ?= @request.auth.partner)")
			}

			if newR != r {
				*rule = types.Pointer(newR)
				changed = true
			}
		}

		// users needs explicit rules; partners manage only customers in their org.
		if c.Name == "users" {
			c.ListRule = types.Pointer(`@request.auth.id != "" && (@request.auth.role = "admin" || id = @request.auth.id || (@request.auth.partner != "" && partner = @request.auth.partner) || sites_via_owner.owner.id ?= @request.auth.id)`)
			c.ViewRule = c.ListRule
			c.CreateRule = types.Pointer(`@request.auth.role = "admin" || (@request.auth.role = "partner" && role = "customer" && partner = @request.auth.partner)`)
			c.UpdateRule = types.Pointer(`@request.auth.role = "admin" || id = @request.auth.id || (@request.auth.role = "partner" && partner = @request.auth.partner && role = "customer")`)
			c.DeleteRule = types.Pointer(`@request.auth.role = "admin" || (@request.auth.role = "partner" && partner = @request.auth.partner && role = "customer")`)
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

var slugRe = regexp.MustCompile(`[^a-z0-9]+`)

func slugify(s string) string {
	s = strings.ToLower(strings.TrimSpace(s))
	s = slugRe.ReplaceAllString(s, "-")
	return strings.Trim(s, "-")
}

func uniqueSlug(app core.App, base, suffix string) string {
	candidate := base
	if candidate == "" {
		candidate = "partner"
	}
	// Append a short unique suffix to avoid collisions while keeping the slug
	// reasonably readable.
	candidate = candidate + "-" + suffix[:8]
	if _, err := app.FindFirstRecordByFilter("partners", "slug = {:slug}", dbx.Params{"slug": candidate}); err == nil {
		// Extremely unlikely, but fall back to the raw suffix if needed.
		candidate = suffix
	}
	return candidate
}
