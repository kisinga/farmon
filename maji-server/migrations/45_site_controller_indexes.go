package migrations

import (
	"github.com/pocketbase/pocketbase/core"
	m "github.com/pocketbase/pocketbase/migrations"
)

// The site list and RBAC rules filter sites by owner and controllers by site.
// These indexes keep those lookups from degrading into full table scans as the
// fleet grows.
func init() {
	m.Register(func(app core.App) error {
		sites, err := app.FindCollectionByNameOrId("sites")
		if err != nil {
			return err
		}
		sites.AddIndex("idx_sites_owner", false, "owner", "")
		if err := app.Save(sites); err != nil {
			return err
		}

		controllers, err := app.FindCollectionByNameOrId("controllers")
		if err != nil {
			return err
		}
		controllers.AddIndex("idx_controllers_site", false, "site", "")
		return app.Save(controllers)
	}, func(app core.App) error {
		sites, err := app.FindCollectionByNameOrId("sites")
		if err == nil {
			sites.RemoveIndex("idx_sites_owner")
			_ = app.Save(sites)
		}
		controllers, err := app.FindCollectionByNameOrId("controllers")
		if err == nil {
			controllers.RemoveIndex("idx_controllers_site")
			_ = app.Save(controllers)
		}
		return nil
	})
}
