package migrations

import (
	"encoding/json"

	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/core"
	m "github.com/pocketbase/pocketbase/migrations"
)

// Denormalized site counts so the catalog can be served by a plain PocketBase
// sites query instead of a custom SQL aggregate. The counts are maintained by
// hooks in internal/server/sites_hooks.go.
func init() {
	m.Register(func(app core.App) error {
		sites, err := app.FindCollectionByNameOrId("sites")
		if err != nil {
			return err
		}

		sites.Fields.Add(
			&core.NumberField{Name: "controller_count"},
			&core.NumberField{Name: "node_count"},
			&core.NumberField{Name: "device_count"},
			&core.NumberField{Name: "live_count"},
		)
		if err := app.Save(sites); err != nil {
			return err
		}

		// Backfill existing sites.
		records, err := app.FindAllRecords("sites")
		if err != nil {
			return err
		}
		for _, site := range records {
			if err := backfillSiteCounts(app, site); err != nil {
				return err
			}
		}
		return nil
	}, func(app core.App) error {
		sites, err := app.FindCollectionByNameOrId("sites")
		if err != nil {
			return nil
		}
		for _, name := range []string{"controller_count", "node_count", "device_count", "live_count"} {
			sites.Fields.RemoveByName(name)
		}
		return app.Save(sites)
	})
}

func backfillSiteCounts(app core.App, site *core.Record) error {
	var topo struct {
		Controllers []any `json:"controllers"`
		Nodes       []any `json:"nodes"`
	}
	_ = json.Unmarshal([]byte(site.GetString("draft_topology")), &topo)
	if topo.Controllers == nil {
		topo.Controllers = []any{}
	}
	if topo.Nodes == nil {
		topo.Nodes = []any{}
	}

	active, live, err := countSiteControllers(app, site.Id)
	if err != nil {
		return err
	}

	site.Set("controller_count", len(topo.Controllers))
	site.Set("node_count", len(topo.Nodes))
	site.Set("device_count", active)
	site.Set("live_count", live)
	return app.Save(site)
}

func countSiteControllers(app core.App, siteID string) (active, live int, err error) {
	rows := []struct {
		Active bool `db:"active"`
		Seen   bool `db:"seen"`
	}{}
	if err := app.DB().NewQuery(
		"SELECT active, COALESCE(last_seen, '') != '' AS seen FROM controllers WHERE site = {:s}",
	).Bind(dbx.Params{"s": siteID}).All(&rows); err != nil {
		return 0, 0, err
	}
	for _, r := range rows {
		if r.Active {
			active++
		}
		if r.Seen {
			live++
		}
	}
	return active, live, nil
}
