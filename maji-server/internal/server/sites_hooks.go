package server

import (
	"encoding/json"

	"github.com/kisinga/majiflow/internal/api"
	"github.com/kisinga/majiflow/internal/config"

	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/apis"
	"github.com/pocketbase/pocketbase/core"
)

// registerSiteHooks guards site ownership and keeps denormalized site counts in
// sync so the catalog can be served by a plain PocketBase sites query.
//
// Site design lives in draft_topology and is autosaved continuously, so it is NOT
// a device-registration trigger: a controller becomes a registered device only at
// provision (firmware Generate). With subscriptions free, entitlement fields
// (packs, addons, price_override) are no longer enforced; owners may edit their
// own sites and the managed device cap is removed.
func registerSiteHooks(app core.App, cfg config.Config) {
	_ = cfg

	app.OnRecordCreateRequest("sites").BindFunc(func(e *core.RecordRequestEvent) error {
		return guardOwnerCreate(e)
	})

	app.OnRecordUpdateRequest("sites").BindFunc(func(e *core.RecordRequestEvent) error {
		return guardOwnerUpdate(e)
	})

	// Keep topology counts in sync on every sites create/update (including
	// app.Save/internal paths) by recomputing before the DB write.
	app.OnModelCreate("sites").BindFunc(func(e *core.ModelEvent) error {
		recomputeTopologyCounts(e.Model.(*core.Record))
		return e.Next()
	})
	app.OnModelUpdate("sites").BindFunc(func(e *core.ModelEvent) error {
		site := e.Model.(*core.Record)
		if topologyChangedForModel(e.App, site) {
			recomputeTopologyCounts(site)
		}
		return e.Next()
	})

	// Keep device/live counts honest whenever a controller row is created,
	// updated, or deleted.
	app.OnRecordAfterCreateSuccess("controllers").BindFunc(func(e *core.RecordEvent) error {
		return refreshSiteDeviceCounts(e.App, e.Record.GetString("site"))
	})
	app.OnRecordAfterUpdateSuccess("controllers").BindFunc(func(e *core.RecordEvent) error {
		return refreshSiteDeviceCounts(e.App, e.Record.GetString("site"))
	})
	app.OnRecordAfterDeleteSuccess("controllers").BindFunc(func(e *core.RecordEvent) error {
		return refreshSiteDeviceCounts(e.App, e.Record.GetString("site"))
	})
}

// guardOwnerCreate stops a customer from creating a site with anyone but
// themselves among its owners. owner is a multi-relation (co-owners), so a
// non-admin may seed only an empty set or one containing solely themselves.
func guardOwnerCreate(e *core.RecordRequestEvent) error {
	if !api.IsAdmin(e.Auth) && e.Auth != nil {
		for _, owner := range e.Record.GetStringSlice("owner") {
			if owner != e.Auth.Id {
				return apis.NewForbiddenError("cannot assign a site to another user", nil)
			}
		}
	}
	return e.Next()
}

// guardOwnerUpdate stops a customer from changing a site's co-owner set (owner has
// no field rule, so without this a customer could rewrite it and lock others out
// or remove themselves). Only admins assign co-owners; order is irrelevant.
func guardOwnerUpdate(e *core.RecordRequestEvent) error {
	if !api.IsAdmin(e.Auth) {
		old, err := e.App.FindRecordById("sites", e.Record.Id)
		if err == nil && !sameStringSet(e.Record.GetStringSlice("owner"), old.GetStringSlice("owner")) {
			return apis.NewForbiddenError("only an admin can reassign a site", nil)
		}
	}
	return e.Next()
}

// topologyChangedForModel reports whether the incoming update modified draft_topology.
// Used to avoid re-parsing the JSON on every autosave that only touched thresholds.
func topologyChangedForModel(app core.App, record *core.Record) bool {
	if record.Id == "" {
		return true
	}
	old, err := app.FindRecordById("sites", record.Id)
	if err != nil {
		return true
	}
	return record.GetString("draft_topology") != old.GetString("draft_topology")
}

// recomputeTopologyCounts sets controller_count and node_count from the site's
// draft_topology JSON. Safe to call on create or when draft_topology changed.
func recomputeTopologyCounts(site *core.Record) {
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
	site.Set("controller_count", len(topo.Controllers))
	site.Set("node_count", len(topo.Nodes))
}

// refreshSiteDeviceCounts recomputes the active-device and live-device counts
// for a site from its controllers table and writes them to the site row.
func refreshSiteDeviceCounts(app core.App, siteID string) error {
	if siteID == "" {
		return nil
	}
	active, live, err := countSiteControllers(app, siteID)
	if err != nil {
		return err
	}
	site, err := app.FindRecordById("sites", siteID)
	if err != nil {
		return nil // site may have been deleted alongside controllers
	}
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

// sameStringSet reports whether two string lists hold the same members, ignoring
// order and duplicates. Used to detect ownership changes.
func sameStringSet(a, b []string) bool {
	set := make(map[string]struct{}, len(a))
	for _, id := range a {
		set[id] = struct{}{}
	}
	seen := make(map[string]struct{}, len(b))
	for _, id := range b {
		if _, ok := set[id]; !ok {
			return false
		}
		seen[id] = struct{}{}
	}
	return len(seen) == len(set)
}
