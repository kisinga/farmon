package migrations

import (
	"github.com/pocketbase/pocketbase/core"
	m "github.com/pocketbase/pocketbase/migrations"
	"github.com/pocketbase/pocketbase/tools/types"
)

// First-class automations — promoted out of the topology JSON (where they were
// gated behind the commissioning design-lock) into their own collection so an
// operator can add/edit/remove them at runtime without unlocking design or a
// firmware reflash. The server serializes a site's rows per controller into a
// retained packed-binary message (see automation-wire.ts); the device fills its
// runtime table. DB is the source of truth; the device is a stateless mirror.
//
// Route identity is carried two ways: route_key (human, for the picker + future
// re-resolution) and route_index + route_set_version (browser-resolved against the
// owning controller's baked route table). The device refuses any set whose
// route_set_version doesn't match its firmware (fail-safe).
//
// RBAC mirrors other site children (adminOrSiteOwner) for ALL of list/view/create/
// update/delete: automations are operational, not design — an owner edits them the
// same way they already issue route commands, with no design-lock involvement.
func init() {
	m.Register(func(app core.App) error {
		adminOrSiteOwner := types.Pointer(`@request.auth.id != "" && (@request.auth.role = "admin" || site.owner = @request.auth.id)`)

		sites, err := app.FindCollectionByNameOrId("sites")
		if err != nil {
			return err
		}
		controllers, err := app.FindCollectionByNameOrId("controllers")
		if err != nil {
			return err
		}

		c := core.NewBaseCollection("automations")
		c.Fields.Add(
			&core.RelationField{Name: "site", CollectionId: sites.Id, MaxSelect: 1, Required: true, CascadeDelete: true},
			// The controller that OWNS the automation's route (browser-stamped). The
			// publish hook serializes per {site, controller} and publishes to that
			// controller's retained topic. Cascade so removing a controller clears its
			// automations.
			&core.RelationField{Name: "controller", CollectionId: controllers.Id, MaxSelect: 1, Required: true, CascadeDelete: true},
			&core.TextField{Name: "name", Max: 120},
			// Route identity.
			&core.TextField{Name: "route_key", Max: 200, Required: true},
			&core.NumberField{Name: "route_index", Min: ptrf(0)},
			&core.NumberField{Name: "route_set_version", Min: ptrf(0), Max: ptrf(65535)},
			// Trigger.
			&core.SelectField{Name: "trigger_type", Values: []string{"time", "level"}, MaxSelect: 1, Required: true},
			&core.NumberField{Name: "time_min", Min: ptrf(0), Max: ptrf(1439)},          // minutes since midnight
			&core.NumberField{Name: "days_mask", Min: ptrf(0), Max: ptrf(127)},          // bit0=MON..bit6=SUN; 0=every day
			&core.NumberField{Name: "level_threshold_pct", Min: ptrf(0), Max: ptrf(100)},
			// Sparse run-param override (only bits set in override_mask apply).
			&core.NumberField{Name: "override_mask", Min: ptrf(0), Max: ptrf(255)},
			&core.NumberField{Name: "ov_source_min_pct", Min: ptrf(0), Max: ptrf(100)},
			&core.NumberField{Name: "ov_dest_max_pct", Min: ptrf(0), Max: ptrf(100)},
			&core.NumberField{Name: "ov_max_runtime_min", Min: ptrf(0), Max: ptrf(120)},
			&core.NumberField{Name: "ov_target_duration_s", Min: ptrf(0), Max: ptrf(7200)},
			&core.NumberField{Name: "ov_target_volume_l", Min: ptrf(0), Max: ptrf(100000)},
			&core.BoolField{Name: "enabled"},
			&core.AutodateField{Name: "created", OnCreate: true},
			&core.AutodateField{Name: "updated", OnCreate: true, OnUpdate: true},
		)
		c.ListRule = adminOrSiteOwner
		c.ViewRule = adminOrSiteOwner
		c.CreateRule = adminOrSiteOwner
		c.UpdateRule = adminOrSiteOwner
		c.DeleteRule = adminOrSiteOwner
		return app.Save(c)
	}, func(app core.App) error {
		c, err := app.FindCollectionByNameOrId("automations")
		if err != nil {
			return nil // already gone
		}
		return app.Delete(c)
	})
}
