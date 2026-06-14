package migrations

import (
	"github.com/pocketbase/pocketbase/core"
	m "github.com/pocketbase/pocketbase/migrations"
)

// Co-owners of a site may read each other's user record (name + email), so the
// dashboard can attribute an action to a named co-owner and show their contact on
// hover — not just the viewer's own record. Previously `users` was admin-or-self
// (02_init_collections), which left a co-owner's command rows anonymous ("operator")
// and blocked any contact detail.
//
// The new clause `sites_via_owner.owner.id ?= @request.auth.id` reads as: the viewed
// user is an owner of some site (the `sites_via_owner` back-relation of `sites.owner`)
// whose owner set ALSO includes the caller — i.e. the two share a site. It correlates
// to the SAME site (the back-relation is scoped to the viewed user's sites), so it
// does not leak unrelated customers to each other.
//
// Email visibility: a customer record is created with emailVisibility=true
// (backend.service customerCreate), so the email field is returned to anyone the
// view rule admits; with this rule that's same-site co-owners (+ self + admin) only.
func init() {
	const cositeRead = `@request.auth.id != "" && (@request.auth.role = "admin" || id = @request.auth.id || sites_via_owner.owner.id ?= @request.auth.id)`
	const adminOrSelf = `@request.auth.id != "" && (@request.auth.role = "admin" || id = @request.auth.id)`

	setUsersRead := func(app core.App, rule string) error {
		c, err := app.FindCollectionByNameOrId("users")
		if err != nil {
			return err
		}
		c.ListRule = &rule
		c.ViewRule = &rule
		return app.Save(c)
	}

	m.Register(func(app core.App) error {
		return setUsersRead(app, cositeRead)
	}, func(app core.App) error {
		return setUsersRead(app, adminOrSelf)
	})
}
