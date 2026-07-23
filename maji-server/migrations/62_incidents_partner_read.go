package migrations

import (
	"github.com/pocketbase/pocketbase/core"
	m "github.com/pocketbase/pocketbase/migrations"
	"github.com/pocketbase/pocketbase/tools/types"
)

// Checkpoint for the notification_incidents read rule — a byte-identical NO-OP
// in the up direction, kept only to preserve the migration numbering.
//
// The rule chain: 41 created the collection owner-only; 49 widened reads with
// `|| site.partner.id ?= @request.auth.id`; 55 converted that clause to the
// org-based form `|| (@request.auth.partner != "" && site.partner.id ?= @request.auth.partner)`,
// which is exactly `partnerRead` below. So partner read access has existed
// since 49 (org-scoped since 55), and this migration's up changes nothing.
// What actually alters effective access is 63, which restricts the clause to
// role = "partner" (customers carry users.partner too, so the unguarded
// clause leaked the whole org's incidents to any customer).
//
// The down therefore must NOT revert to the 41-era owner-only rule — that
// would strip partner access granted three migrations earlier. It restores
// the exact 55-era rule (same text as the up, since the up is a no-op).
func init() {
	// Exact 55-era ListRule/ViewRule for notification_incidents.
	partnerRead := `@request.auth.id != "" && (@request.auth.role = "admin" || site.owner.id ?= @request.auth.id || (@request.auth.partner != "" && site.partner.id ?= @request.auth.partner))`

	m.Register(func(app core.App) error {
		c, err := app.FindCollectionByNameOrId("notification_incidents")
		if err != nil {
			return err
		}
		c.ListRule = types.Pointer(partnerRead)
		c.ViewRule = types.Pointer(partnerRead)
		return app.Save(c)
	}, func(app core.App) error {
		c, err := app.FindCollectionByNameOrId("notification_incidents")
		if err != nil {
			return nil // already gone
		}
		// Restore the 55-era state — identical text, see the header comment.
		c.ListRule = types.Pointer(partnerRead)
		c.ViewRule = types.Pointer(partnerRead)
		return app.Save(c)
	})
}
