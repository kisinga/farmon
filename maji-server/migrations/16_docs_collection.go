package migrations

import (
	"github.com/pocketbase/pocketbase/core"
	m "github.com/pocketbase/pocketbase/migrations"
	"github.com/pocketbase/pocketbase/tools/types"
)

// `docs` is the DB-backed store for non-developer product documentation: the
// operational/safety/troubleshooting narrative, the wiring guide, the glossary,
// and one entry per node kind. It is the single source of truth for that prose
// (board reference docs travel inside the board `def` instead). Bodies are
// markdown with `{{slot}}` placeholders the per-site assembler fills with live
// values. Domain content: any authenticated user may read it; only admins write.
//
// `slug` is the single key that identifies a doc. For category=node it IS the
// node kind (e.g. "valve"), so a component is identified by one key everywhere;
// for other categories it's a free slug. `category` places the doc and selects
// the variable vocabulary the drift guard checks the body against.
func init() {
	m.Register(func(app core.App) error {
		authed := types.Pointer(`@request.auth.id != ""`)
		adminOnly := types.Pointer(`@request.auth.role = "admin"`)

		docs := core.NewBaseCollection("docs")
		docs.Fields.Add(
			&core.TextField{Name: "slug", Required: true, Max: 100},
			&core.TextField{Name: "title", Max: 200},
			&core.SelectField{Name: "category", Values: []string{"narrative", "node", "wiring", "glossary"}, MaxSelect: 1},
			&core.NumberField{Name: "order"},
			&core.TextField{Name: "body", Max: 200_000},
			&core.AutodateField{Name: "created", OnCreate: true},
			&core.AutodateField{Name: "updated", OnCreate: true, OnUpdate: true},
		)
		docs.AddIndex("idx_docs_slug", true, "slug", "")
		docs.ListRule = authed
		docs.ViewRule = authed
		docs.CreateRule = adminOnly
		docs.UpdateRule = adminOnly
		docs.DeleteRule = adminOnly
		return app.Save(docs)
	}, func(app core.App) error {
		if c, err := app.FindCollectionByNameOrId("docs"); err == nil {
			return app.Delete(c)
		}
		return nil
	})
}
