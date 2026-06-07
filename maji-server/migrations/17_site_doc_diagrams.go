package migrations

import (
	"github.com/pocketbase/pocketbase/core"
	m "github.com/pocketbase/pocketbase/migrations"
)

// Sites gain `doc_diagrams`: the topology SVGs for the site's documentation,
// rendered in the admin browser by the same X6 engine as the editor canvas (so
// they can't drift from what the designer saw) and cached here. Shape:
// `{ composite: string, controllers: { [controllerId]: string } }`. The per-site
// doc assembler injects them as strings, so the customer dashboard renders the
// document (live values + cached diagrams) without ever loading X6. Structural,
// not live — the admin re-publishes when the topology changes.
func init() {
	m.Register(func(app core.App) error {
		c, err := app.FindCollectionByNameOrId("sites")
		if err != nil {
			return err
		}
		c.Fields.Add(&core.JSONField{Name: "doc_diagrams", MaxSize: 5_000_000})
		return app.Save(c)
	}, func(app core.App) error {
		c, err := app.FindCollectionByNameOrId("sites")
		if err != nil {
			return err
		}
		c.Fields.RemoveByName("doc_diagrams")
		return app.Save(c)
	})
}
