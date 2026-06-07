package migrations

import (
	"github.com/pocketbase/pocketbase/core"
	m "github.com/pocketbase/pocketbase/migrations"
)

// Adds `board_versions` to topology_versions: a `{ model: version }` map of the
// board catalog revisions a commit was built against. This is traceability
// metadata only — the full board definitions are not snapshotted, just their
// versions, so a committed bundle can be tied back to the exact board revisions.
func init() {
	m.Register(func(app core.App) error {
		versions, err := app.FindCollectionByNameOrId("topology_versions")
		if err != nil {
			return err
		}
		versions.Fields.Add(&core.JSONField{Name: "board_versions", MaxSize: 100_000})
		return app.Save(versions)
	}, func(app core.App) error {
		versions, err := app.FindCollectionByNameOrId("topology_versions")
		if err != nil {
			return err
		}
		versions.Fields.RemoveByName("board_versions")
		return app.Save(versions)
	})
}
