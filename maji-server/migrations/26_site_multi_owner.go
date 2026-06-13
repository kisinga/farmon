package migrations

import (
	"strings"

	"github.com/pocketbase/pocketbase/core"
	m "github.com/pocketbase/pocketbase/migrations"
)

// A site moves from a single owner to a set of co-owners: `sites.owner` becomes
// a multi-relation and every co-owner gets equal, full access. Admins assign any
// number of users to a site (and a user to any number of sites) — a plain
// many-to-many, no primary/secondary distinction.
//
// The field keeps its name (`owner`) so the existing data column and the dozen
// rule strings that reference it across collections stay put; only the cardinality
// and the comparison operator change. RBAC was `owner = @request.auth.id` (and
// `site.owner = @request.auth.id` on child collections); with a multi-relation the
// match becomes the "any of" relation operator `owner.id ?= @request.auth.id`,
// which reads the related users and is true when the caller is among them. We
// rewrite that fragment in place on every collection rule that carries it, so
// children added by later migrations (runtime state, events, automations,
// telemetry) all keep working without each repeating the new syntax.
const (
	oldOwnerMatch = "owner = @request.auth.id"
	newOwnerMatch = "owner.id ?= @request.auth.id"
)

func init() {
	m.Register(func(app core.App) error {
		// 1. Widen the relation: single owner → set of co-owners.
		sites, err := app.FindCollectionByNameOrId("sites")
		if err != nil {
			return err
		}
		owner, ok := sites.Fields.GetByName("owner").(*core.RelationField)
		if !ok {
			return nil // unexpected shape — leave it for a human
		}
		owner.MaxSelect = 50 // generous cap; sites realistically have a handful of co-owners
		if err := app.Save(sites); err != nil {
			return err
		}
		// NOTE: changing the relation single→multi makes PocketBase rewrite the
		// owner column itself (json_array(owner) per row), so no per-record save is
		// needed here — and must NOT be attempted: app.Save() re-validates the
		// relation, and a legacy cell that converts to a quoted id (see migration 27)
		// would fail that validation and roll back the whole migration. Column
		// repair for those legacy rows is handled separately by migration 27.

		// 2. Rewrite the ownership match operator on every collection rule.
		return rewriteOwnerRules(app, oldOwnerMatch, newOwnerMatch)
	}, func(app core.App) error {
		// Down: restore the equality operator and re-collapse to a single owner
		// (first co-owner wins). Raw column SQL — no per-record re-validation.
		if err := rewriteOwnerRules(app, newOwnerMatch, oldOwnerMatch); err != nil {
			return err
		}
		if _, err := app.DB().NewQuery(
			`UPDATE sites SET owner = CASE
			    WHEN owner IS NULL OR owner = '' OR owner = '[]' THEN ''
			    WHEN json_valid(owner) AND json_type(owner) = 'array' THEN COALESCE(json_extract(owner, '$[0]'), '')
			    ELSE owner
			 END`,
		).Execute(); err != nil {
			return err
		}
		sites, err := app.FindCollectionByNameOrId("sites")
		if err != nil {
			return err
		}
		if owner, ok := sites.Fields.GetByName("owner").(*core.RelationField); ok {
			owner.MaxSelect = 1
			return app.Save(sites)
		}
		return nil
	})
}

// rewriteOwnerRules swaps `from` → `to` in every List/View/Create/Update/Delete
// rule across all collections. The `site.owner = …` fragment on child collections
// ends with the same `owner = …` suffix, so a single substring swap updates both
// the site rules and every child rule.
func rewriteOwnerRules(app core.App, from, to string) error {
	cols, err := app.FindAllCollections()
	if err != nil {
		return err
	}
	for _, c := range cols {
		changed := false
		for _, rule := range []**string{&c.ListRule, &c.ViewRule, &c.CreateRule, &c.UpdateRule, &c.DeleteRule} {
			if *rule != nil && strings.Contains(**rule, from) {
				v := strings.ReplaceAll(**rule, from, to)
				*rule = &v
				changed = true
			}
		}
		if changed {
			if err := app.Save(c); err != nil {
				return err
			}
		}
	}
	return nil
}
