package migrations

import (
	"github.com/pocketbase/pocketbase/core"
	m "github.com/pocketbase/pocketbase/migrations"
	"github.com/pocketbase/pocketbase/tools/types"
)

// `boards` is the DB-backed board catalog — the single source of truth for
// hardware definitions, replacing the static `public/boards` assets and the
// hardcoded expansion-board map. Records are seeded from `defaults/boards/` at
// boot (see internal/server/seed.go). The catalog is domain data: any
// authenticated user may read it; only admins mutate it.
func init() {
	m.Register(func(app core.App) error {
		authed := types.Pointer(`@request.auth.id != ""`)
		adminOnly := types.Pointer(`@request.auth.role = "admin"`)

		boards := core.NewBaseCollection("boards")
		boards.Fields.Add(
			&core.TextField{Name: "model", Required: true, Max: 100},
			&core.TextField{Name: "label", Max: 200},
			&core.SelectField{Name: "kind", Values: []string{"main", "expansion"}, MaxSelect: 1},
			// Monotonic catalog version, bumped on each definition change. Recorded
			// into committed topology_versions for traceability (which board
			// revision a firmware bundle was built against).
			&core.NumberField{Name: "version"},
			&core.JSONField{Name: "def", MaxSize: 1_000_000},
			&core.FileField{Name: "svg", MaxSelect: 1, MaxSize: 1_000_000, MimeTypes: []string{"image/svg+xml"}},
			&core.AutodateField{Name: "created", OnCreate: true},
			&core.AutodateField{Name: "updated", OnCreate: true, OnUpdate: true},
		)
		boards.AddIndex("idx_boards_model", true, "model", "")
		boards.ListRule = authed
		boards.ViewRule = authed
		boards.CreateRule = adminOnly
		boards.UpdateRule = adminOnly
		boards.DeleteRule = adminOnly

		return app.Save(boards)
	}, func(app core.App) error {
		if c, err := app.FindCollectionByNameOrId("boards"); err == nil {
			return app.Delete(c)
		}
		return nil
	})
}
