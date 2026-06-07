package migrations

import (
	"github.com/pocketbase/pocketbase/core"
	m "github.com/pocketbase/pocketbase/migrations"
)

// Foundational `sites` collection backing the editor's draft topology. The full
// schema (controllers, topology_versions, telemetry_*, RBAC rules) lands in
// Phase 2.
func init() {
	m.Register(func(app core.App) error {
		collection := core.NewBaseCollection("sites")
		collection.Fields.Add(
			&core.TextField{Name: "name", Required: true, Max: 200},
			&core.TextField{Name: "slug", Max: 200},
			&core.JSONField{Name: "draft_topology", MaxSize: 5_000_000},
			&core.TextField{Name: "owner", Max: 50},
			&core.AutodateField{Name: "created", OnCreate: true},
			&core.AutodateField{Name: "updated", OnCreate: true, OnUpdate: true},
		)
		return app.Save(collection)
	}, func(app core.App) error {
		collection, err := app.FindCollectionByNameOrId("sites")
		if err != nil {
			return err
		}
		return app.Delete(collection)
	})
}
