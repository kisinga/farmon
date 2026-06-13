package migrations

import (
	"encoding/json"
	"regexp"

	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/core"
	m "github.com/pocketbase/pocketbase/migrations"
)

// Repairs sites.owner after 26. When 26 widened owner from single→multi,
// PocketBase's own column conversion ran `json_array(owner)` on the old value.
// That is correct for a bare id (`abc` → `["abc"]`), but for any owner cell that
// was a JSON-quoted string (`"abc"`) it produced `["\"abc\""]` — the id kept its
// literal quotes — so `owner.id ?= @request.auth.id` no longer matched and every
// co-owner was locked out of their own site (a 404 on view) while admins, who
// match on the role branch, were unaffected.
//
// The original ids survive inside those mangled values, so this is recoverable:
// for each site we pull every real user id out of the raw owner text (regardless
// of how it was wrapped), drop anything that isn't an actual user, and rewrite a
// clean JSON-array column. Pure column SQL — no record validation, no hooks — so
// a heavy draft_topology or any legacy field can't abort it.
//
// Idempotent: a clean `["abc"]` cell yields `["abc"]` again.
func init() {
	m.Register(func(app core.App) error {
		// Real user ids, to filter extracted candidates against (so a stray token
		// or a since-deleted owner never lands back in the column).
		var userIDs []string
		if err := app.DB().NewQuery("SELECT id FROM users").Column(&userIDs); err != nil {
			return err
		}
		valid := make(map[string]struct{}, len(userIDs))
		for _, id := range userIDs {
			valid[id] = struct{}{}
		}

		type siteRow struct {
			Id    string `db:"id"`
			Owner string `db:"owner"`
		}
		var rows []siteRow
		if err := app.DB().NewQuery("SELECT id, COALESCE(owner, '') AS owner FROM sites").All(&rows); err != nil {
			return err
		}

		// PocketBase ids are 15-char [a-z0-9]; pull every such run out of the raw
		// value (handles bare, quoted, array, and quote-mangled forms alike).
		idRe := regexp.MustCompile(`[a-z0-9]{15}`)
		var repaired, emptied int
		for _, r := range rows {
			seen := map[string]struct{}{}
			owners := []string{}
			for _, cand := range idRe.FindAllString(r.Owner, -1) {
				if _, ok := valid[cand]; !ok {
					continue
				}
				if _, dup := seen[cand]; dup {
					continue
				}
				seen[cand] = struct{}{}
				owners = append(owners, cand)
			}
			cleaned, err := json.Marshal(owners) // [] when none, else ["id",...]
			if err != nil {
				return err
			}
			if string(cleaned) == r.Owner {
				continue // already clean — leave it
			}
			if _, err := app.DB().NewQuery("UPDATE sites SET owner = {:v} WHERE id = {:id}").
				Bind(dbx.Params{"v": string(cleaned), "id": r.Id}).Execute(); err != nil {
				return err
			}
			repaired++
			if len(owners) == 0 && r.Owner != "" && r.Owner != "[]" {
				emptied++ // had content we could not resolve to a real user — needs manual reassignment
			}
		}
		app.Logger().Info("27_repair_site_owner: owner column repaired",
			"sites_rewritten", repaired, "sites_left_empty", emptied)
		return nil
	}, func(app core.App) error {
		return nil // data repair only — nothing to undo
	})
}
