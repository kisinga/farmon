package migrations

import (
	"github.com/pocketbase/pocketbase/core"
	m "github.com/pocketbase/pocketbase/migrations"
	"github.com/pocketbase/pocketbase/tools/types"
)

// runs: the billing-grade per-run ledger. One immutable row per route activation
// (a "run"), carrying both axes — duration (always) and delivered litres (when the
// route is metered). It is the source of truth for invoicing tenants, so unlike the
// telemetry/event tables it is NEVER pruned (absent from telemetry.Prune; guarded by
// a test) and survives device decommission.
//
// Durability shape:
//   - `site` is a relation with CascadeDelete:false, so deleting a controller (or a
//     site) leaves the row intact rather than erasing billing history; while the site
//     exists the owner read rule `site.owner` still resolves.
//   - `controller` is a denormalized text id (the device id from the MQTT topic), the
//     idempotency anchor, kept as text so it survives the controller record's deletion.
//   - `run_id` is the device-minted composite (epoch+seq); `(controller, run_id)` is
//     unique, so a re-asserted run upserts to a no-op. `epoch`/`seq` are also stored as
//     separate numbers so the retained runs_ack high-water-mark can be compared exactly
//     (the uint64 run_id is past float64's exact range).
//
// Written server-side by IngestSnapshot (app.Save bypasses API rules); customers get
// read access scoped to their sites and nothing else.
func init() {
	m.Register(func(app core.App) error {
		adminOrSiteOwner := types.Pointer(`@request.auth.id != "" && (@request.auth.role = "admin" || site.owner = @request.auth.id)`)
		adminOnly := types.Pointer(`@request.auth.role = "admin"`)

		sites, err := app.FindCollectionByNameOrId("sites")
		if err != nil {
			return err
		}

		c := core.NewBaseCollection("runs")
		c.Fields.Add(
			&core.RelationField{Name: "site", CollectionId: sites.Id, MaxSelect: 1, Required: true, CascadeDelete: false},
			&core.TextField{Name: "controller", Required: true, Max: 100},
			&core.NumberField{Name: "route"},
			&core.TextField{Name: "run_id", Required: true, Max: 40},
			&core.NumberField{Name: "epoch"},
			&core.NumberField{Name: "seq"},
			&core.TextField{Name: "actor", Max: 100},
			&core.TextField{Name: "actor_label", Max: 120},
			&core.TextField{Name: "origin", Max: 20},
			&core.TextField{Name: "started_at", Max: 40},
			&core.TextField{Name: "ended_at", Max: 40},
			&core.NumberField{Name: "duration_s"},
			&core.TextField{Name: "stop_reason", Max: 40},
			// Absolute durable-counter readings at the run boundaries (integer litres).
			// delivered = end - start; storing both also lets the facade cross-check
			// continuity (end_litres of run N == start_litres of run N+1 on a route).
			&core.NumberField{Name: "start_litres"},
			&core.NumberField{Name: "end_litres"},
			&core.BoolField{Name: "metered"},
			&core.TextField{Name: "fault", Max: 40},
			&core.AutodateField{Name: "created", OnCreate: true},
		)
		// Idempotency: a re-asserted run (same device + run_id) is a duplicate, not an update.
		c.AddIndex("idx_runs_id", true, "controller,run_id", "")
		// Billing: a site's runs over a period.
		c.AddIndex("idx_runs_site", false, "site,started_at", "")
		// Continuity check: consecutive metered runs on a route within an epoch.
		c.AddIndex("idx_runs_continuity", false, "controller,route,epoch,seq", "")
		c.ListRule = adminOrSiteOwner
		c.ViewRule = adminOrSiteOwner
		c.CreateRule = adminOnly
		c.UpdateRule = adminOnly
		c.DeleteRule = adminOnly
		return app.Save(c)
	}, func(app core.App) error {
		if c, err := app.FindCollectionByNameOrId("runs"); err == nil {
			return app.Delete(c)
		}
		return nil
	})
}
