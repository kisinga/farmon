package migrations

import (
	"slices"

	"github.com/pocketbase/pocketbase/core"
	m "github.com/pocketbase/pocketbase/migrations"
	"github.com/pocketbase/pocketbase/tools/types"
)

// OTA firmware releases. A release is an admin-uploaded compiled binary for one
// controller, tracked through its lifecycle: uploaded → deployed → confirmed
// (the device reported the matching version after flashing). The binary lives on
// the row but is retained latest-only — uploading a new release for a controller
// clears the bin on its older rows, so we keep the full release history (who,
// when, which version, md5) while bounding storage to the current image.
//
// The device downloads the bin from a token-gated streaming endpoint (it has no
// PocketBase session); the per-release download_token + download_expires below are
// the unguessable, short-lived capability minted at deploy time and embedded in
// the firmware_update MQTT command's URL.
//
// This migration also widens commands.action to accept "firmware_update" so the
// deploy endpoint can record the imperative in the same audit collection as every
// other operator command (mirrors the CommandEnvelope union in codegen-ids.ts).
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
		users, err := app.FindCollectionByNameOrId("users")
		if err != nil {
			return err
		}

		rel := core.NewBaseCollection("firmware_releases")
		rel.Fields.Add(
			&core.RelationField{Name: "site", CollectionId: sites.Id, MaxSelect: 1, Required: true, CascadeDelete: true},
			&core.RelationField{Name: "controller", CollectionId: controllers.Id, MaxSelect: 1, Required: true, CascadeDelete: true},
			&core.TextField{Name: "version", Max: 100},
			&core.TextField{Name: "md5", Max: 64},
			&core.NumberField{Name: "size"},
			&core.FileField{Name: "firmware_bin", MaxSelect: 1, MaxSize: 30_000_000},
			&core.RelationField{Name: "uploaded_by", CollectionId: users.Id, MaxSelect: 1},
			&core.SelectField{Name: "status", Values: []string{"uploaded", "deployed", "confirmed", "failed"}, MaxSelect: 1},
			&core.DateField{Name: "deployed_at"},
			// Token-gated device download: a single-purpose, expiring capability the
			// device presents to the streaming endpoint. Hidden from the API surface.
			&core.TextField{Name: "download_token", Max: 100, Hidden: true},
			&core.DateField{Name: "download_expires"},
			&core.AutodateField{Name: "created", OnCreate: true},
		)
		// "latest release for a controller" is the hot lookup (upload prune + deploy).
		rel.AddIndex("idx_firmware_releases_lookup", false, "controller,created", "")
		rel.ListRule = adminOrSiteOwner
		rel.ViewRule = adminOrSiteOwner
		rel.CreateRule = adminOnly // created only through the upload endpoint (app.Save)
		rel.UpdateRule = adminOnly
		rel.DeleteRule = adminOnly
		if err := app.Save(rel); err != nil {
			return err
		}

		// Widen commands.action so the deploy endpoint's audit row validates.
		if c, err := app.FindCollectionByNameOrId("commands"); err == nil {
			if f, ok := c.Fields.GetByName("action").(*core.SelectField); ok {
				if !slices.Contains(f.Values, "firmware_update") {
					f.Values = append(f.Values, "firmware_update")
					if err := app.Save(c); err != nil {
						return err
					}
				}
			}
		}
		return nil
	}, func(app core.App) error {
		if c, err := app.FindCollectionByNameOrId("firmware_releases"); err == nil {
			if err := app.Delete(c); err != nil {
				return err
			}
		}
		if c, err := app.FindCollectionByNameOrId("commands"); err == nil {
			if f, ok := c.Fields.GetByName("action").(*core.SelectField); ok {
				f.Values = slices.DeleteFunc(f.Values, func(v string) bool { return v == "firmware_update" })
				if err := app.Save(c); err != nil {
					return err
				}
			}
		}
		return nil
	})
}
