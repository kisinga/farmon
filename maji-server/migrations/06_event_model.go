package migrations

import (
	"github.com/pocketbase/pocketbase/core"
	m "github.com/pocketbase/pocketbase/migrations"
	"github.com/pocketbase/pocketbase/tools/types"
)

// Event-model delta: the shadow gains a `reported_text` column so categorical
// channels (system_state, stop_reason, …) can hold their human-readable token
// alongside the numeric `reported` used for charts; and a new append-only
// `state_events` collection records each transition for the timeline + audit +
// point-in-time fold. Written by the server-internal ingest path (bypasses API
// rules); customers get read access scoped to their sites.
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

		// --- entity_state: add reported_text beside numeric reported ----------
		state, err := app.FindCollectionByNameOrId("entity_state")
		if err != nil {
			return err
		}
		state.Fields.Add(&core.TextField{Name: "reported_text", Max: 100})
		if err := app.Save(state); err != nil {
			return err
		}

		// --- state_events: append-only transition log -------------------------
		// `from_state`/`to_state` are the system/route state tokens; `reason` is a
		// stop-reason / fault / outcome token; `route` is the route id (-1 = system).
		// Column names avoid the SQL keywords from/to. The wire StateEvent keeps
		// `from`/`to` — the ingest maps them.
		ev := core.NewBaseCollection("state_events")
		ev.Fields.Add(
			&core.RelationField{Name: "site", CollectionId: sites.Id, MaxSelect: 1, Required: true, CascadeDelete: true},
			&core.RelationField{Name: "controller", CollectionId: controllers.Id, MaxSelect: 1, CascadeDelete: true},
			&core.NumberField{Name: "route"},
			&core.TextField{Name: "from_state", Max: 40},
			&core.TextField{Name: "to_state", Max: 40},
			&core.TextField{Name: "reason", Max: 40},
			&core.TextField{Name: "command_id", Max: 100},
			&core.TextField{Name: "ts", Max: 40},
			&core.AutodateField{Name: "created", OnCreate: true},
		)
		ev.AddIndex("idx_state_events_timeline", false, "site,controller,ts", "")
		ev.ListRule = adminOrSiteOwner
		ev.ViewRule = adminOrSiteOwner
		ev.CreateRule = adminOnly
		ev.UpdateRule = adminOnly
		ev.DeleteRule = adminOnly
		if err := app.Save(ev); err != nil {
			return err
		}

		return nil
	}, func(app core.App) error {
		if c, err := app.FindCollectionByNameOrId("state_events"); err == nil {
			if err := app.Delete(c); err != nil {
				return err
			}
		}
		if state, err := app.FindCollectionByNameOrId("entity_state"); err == nil {
			state.Fields.RemoveByName("reported_text")
			if err := app.Save(state); err != nil {
				return err
			}
		}
		return nil
	})
}
