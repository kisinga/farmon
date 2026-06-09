package migrations

import (
	"github.com/pocketbase/pocketbase/core"
	m "github.com/pocketbase/pocketbase/migrations"
	"github.com/pocketbase/pocketbase/tools/types"
)

// Runtime state: the device shadow (last-known value per sensor, never pruned)
// and the operator command audit log. Both are written by server-internal
// paths (ingest hook / command endpoint, which bypass API rules), so customers
// get read access scoped to their sites and nothing else.
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

		// --- entity_state: device shadow (one row per sensor, never pruned) ---
		// `reported` = last value the device published; `desired` = last value an
		// operator command set (for set-point style actuators). Aggressive raw
		// pruning never touches this, so current state stays accurate.
		state := core.NewBaseCollection("entity_state")
		state.Fields.Add(
			&core.RelationField{Name: "site", CollectionId: sites.Id, MaxSelect: 1, Required: true, CascadeDelete: true},
			&core.RelationField{Name: "controller", CollectionId: controllers.Id, MaxSelect: 1, Required: true, CascadeDelete: true},
			&core.TextField{Name: "sensor", Max: 100},
			&core.NumberField{Name: "reported"},
			&core.NumberField{Name: "desired"},
			&core.TextField{Name: "ts", Max: 40},
			&core.AutodateField{Name: "updated", OnCreate: true, OnUpdate: true},
		)
		state.AddIndex("idx_entity_state_key", true, "site,controller,sensor", "")
		state.ListRule = adminOrSiteOwner
		state.ViewRule = adminOrSiteOwner
		state.CreateRule = adminOnly
		state.UpdateRule = adminOnly
		state.DeleteRule = adminOnly
		if err := app.Save(state); err != nil {
			return err
		}

		// --- commands: operator command audit + reconciliation -------------
		commands := core.NewBaseCollection("commands")
		commands.Fields.Add(
			&core.RelationField{Name: "site", CollectionId: sites.Id, MaxSelect: 1, Required: true, CascadeDelete: true},
			&core.RelationField{Name: "controller", CollectionId: controllers.Id, MaxSelect: 1, Required: true, CascadeDelete: true},
			&core.TextField{Name: "command_id", Required: true, Max: 100},
			&core.SelectField{Name: "action", MaxSelect: 1, Values: []string{
				"route_start", "route_stop", "fault_reset", "stop_all", "reset_faults", "clear_queue",
			}},
			&core.NumberField{Name: "route_id"},
			&core.SelectField{Name: "status", MaxSelect: 1, Values: []string{"sent", "done", "failed"}},
			&core.TextField{Name: "result", Max: 200},
			&core.RelationField{Name: "issued_by", CollectionId: users.Id, MaxSelect: 1},
			&core.AutodateField{Name: "created", OnCreate: true},
			&core.AutodateField{Name: "updated", OnCreate: true, OnUpdate: true},
		)
		commands.AddIndex("idx_commands_command_id", true, "command_id", "")
		// Reconciliation lists a site's recent commands (pending → done).
		commands.AddIndex("idx_commands_site", false, "site,created", "")
		// Created by the command endpoint (app.Save bypasses rules); customers
		// only read their site's commands (for pending → done reconciliation).
		commands.ListRule = adminOrSiteOwner
		commands.ViewRule = adminOrSiteOwner
		commands.CreateRule = adminOnly
		commands.UpdateRule = adminOnly
		commands.DeleteRule = adminOnly
		if err := app.Save(commands); err != nil {
			return err
		}

		return nil
	}, func(app core.App) error {
		for _, name := range []string{"commands", "entity_state"} {
			if c, err := app.FindCollectionByNameOrId(name); err == nil {
				if err := app.Delete(c); err != nil {
					return err
				}
			}
		}
		return nil
	})
}
