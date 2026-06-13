package migrations

import (
	"github.com/pocketbase/pocketbase/core"
	m "github.com/pocketbase/pocketbase/migrations"
	"github.com/pocketbase/pocketbase/tools/types"
)

// Collapse the per-sensor `entity_state` shadow into ONE `controller_state` doc per
// controller — the latest snapshot, stored whole. The device sends one snapshot per
// interval, so one doc upsert + one realtime event replaces N rows + N events, and
// the dead `desired` column goes with the old table. Numeric history still lives in
// telemetry_raw (rollups); the transition timeline in state_events.
//
// The `snapshot` JSON holds readings/text/system/routes(+ resolved origin labels)/
// outcomes; the dashboard explodes it back into its per-channel view, and the alert
// sweep reads tank levels straight out of it.
func init() {
	m.Register(func(app core.App) error {
		sites, err := app.FindCollectionByNameOrId("sites")
		if err != nil {
			return err
		}
		controllers, err := app.FindCollectionByNameOrId("controllers")
		if err != nil {
			return err
		}
		adminOrSiteOwner := types.Pointer(`@request.auth.id != "" && (@request.auth.role = "admin" || site.owner.id ?= @request.auth.id)`)
		adminOnly := types.Pointer(`@request.auth.role = "admin"`)

		cs := core.NewBaseCollection("controller_state")
		cs.Fields.Add(
			&core.RelationField{Name: "site", CollectionId: sites.Id, MaxSelect: 1, Required: true, CascadeDelete: true},
			&core.RelationField{Name: "controller", CollectionId: controllers.Id, MaxSelect: 1, Required: true, CascadeDelete: true},
			&core.JSONField{Name: "snapshot", MaxSize: 200_000},
			&core.TextField{Name: "ts", Max: 40},
			&core.AutodateField{Name: "updated", OnCreate: true, OnUpdate: true},
		)
		cs.AddIndex("idx_controller_state_key", true, "site,controller", "")
		cs.ListRule = adminOrSiteOwner
		cs.ViewRule = adminOrSiteOwner
		cs.CreateRule = adminOnly // writes happen via the ingest hook (app.Save bypasses rules)
		cs.UpdateRule = adminOnly
		cs.DeleteRule = adminOnly
		if err := app.Save(cs); err != nil {
			return err
		}

		// Drop the per-sensor shadow it replaces.
		if old, err := app.FindCollectionByNameOrId("entity_state"); err == nil {
			if err := app.Delete(old); err != nil {
				return err
			}
		}
		return nil
	}, func(app core.App) error {
		// One-way: the down only removes controller_state (entity_state is not
		// recreated — its data is reconstructed from the next snapshot anyway).
		if cs, err := app.FindCollectionByNameOrId("controller_state"); err == nil {
			return app.Delete(cs)
		}
		return nil
	})
}
