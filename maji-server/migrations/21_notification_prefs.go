package migrations

import (
	"github.com/pocketbase/pocketbase/core"
	m "github.com/pocketbase/pocketbase/migrations"
	"github.com/pocketbase/pocketbase/tools/types"
)

// Per-user notification preferences: which alert types the user cares about and
// whether to also receive them by email. Written directly by the frontend
// account page (one row per user, enforced by the unique index) and read by the
// server email sweep to decide whom to mail. The in-app center also reads it to
// filter the bell. Bool fields default to false/zero in the DB; the readers
// treat "no row" as all-on, and the account page writes explicit values.
func init() {
	m.Register(func(app core.App) error {
		users, err := app.FindCollectionByNameOrId("users")
		if err != nil {
			return err
		}

		// A user manages only their own prefs; admins may read any. Create is
		// gated on the submitted `user` matching the caller so nobody can seed a
		// row for someone else.
		selfOrAdmin := types.Pointer(`@request.auth.id != "" && (@request.auth.role = "admin" || user = @request.auth.id)`)
		createSelf := types.Pointer(`@request.auth.id != "" && (@request.auth.role = "admin" || @request.body.user = @request.auth.id)`)

		prefs := core.NewBaseCollection("notification_prefs")
		prefs.Fields.Add(
			&core.RelationField{Name: "user", CollectionId: users.Id, MaxSelect: 1, Required: true, CascadeDelete: true},
			&core.BoolField{Name: "alert_device_offline"},
			&core.BoolField{Name: "alert_fault"},
			&core.BoolField{Name: "alert_tank"},
			&core.BoolField{Name: "alert_command_failed"},
			&core.BoolField{Name: "channel_email"},
			&core.AutodateField{Name: "created", OnCreate: true},
			&core.AutodateField{Name: "updated", OnCreate: true, OnUpdate: true},
		)
		// One prefs row per user.
		prefs.AddIndex("idx_notification_prefs_user", true, "user", "")
		prefs.ListRule = selfOrAdmin
		prefs.ViewRule = selfOrAdmin
		prefs.CreateRule = createSelf
		prefs.UpdateRule = selfOrAdmin
		prefs.DeleteRule = selfOrAdmin
		return app.Save(prefs)
	}, func(app core.App) error {
		if c, err := app.FindCollectionByNameOrId("notification_prefs"); err == nil {
			return app.Delete(c)
		}
		return nil
	})
}
