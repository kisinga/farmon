package migrations

import (
	"github.com/pocketbase/pocketbase/core"
	m "github.com/pocketbase/pocketbase/migrations"
	"github.com/pocketbase/pocketbase/tools/types"
)

// app_config: a single-row table of global, admin-tunable settings that are NOT
// environment config. Env covers infrastructure (where the broker binds, the SPA
// dir); this covers business rules (the managed device cap, …). The server reads
// it and the admin UI gets it via GET /api/farmon/config. Created with one row
// holding the defaults — bootstrapping config, not catalog seeding.
func init() {
	m.Register(func(app core.App) error {
		adminOnly := types.Pointer(`@request.auth.role = "admin"`)
		c := core.NewBaseCollection("app_config")
		c.Fields.Add(
			&core.NumberField{Name: "hosting_device_cap"},
			&core.AutodateField{Name: "updated", OnCreate: true, OnUpdate: true},
		)
		c.ListRule = adminOnly
		c.ViewRule = adminOnly
		c.CreateRule = adminOnly
		c.UpdateRule = adminOnly
		c.DeleteRule = adminOnly
		if err := app.Save(c); err != nil {
			return err
		}
		// Seed the singleton with defaults (mirrors hostingDeviceCap in routes.go).
		rec := core.NewRecord(c)
		rec.Set("hosting_device_cap", 5)
		return app.Save(rec)
	}, func(app core.App) error {
		c, err := app.FindCollectionByNameOrId("app_config")
		if err != nil {
			return err
		}
		return app.Delete(c)
	})
}
