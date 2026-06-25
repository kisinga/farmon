package migrations

import (
	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/core"
	m "github.com/pocketbase/pocketbase/migrations"
	"github.com/pocketbase/pocketbase/tools/types"
)

// commandActionsV37 is the V25 action set with config_set removed — i.e. back to the
// V10 list (V25 = V10 + "config_set"). config_set is retired here alongside creating
// controller_config: runtime config is now the server-owned desired-config model
// (the dashboard writes controller_config -> the server recomputes + republishes the
// retained /config message -> the device converges), so the one-shot imperative is gone.
var commandActionsV37 = commandActionsV10

// controller_config: the ONE server-owned "desired controller config" — the
// unified bag of tunables + calibration the device must converge to (automations
// keep their own collection + retained set; this is the rest). One row per
// controller, the single write path: the dashboard writes `desired` (the opaque
// per-key value map it wants applied), and a server Register hook recomputes the
// canonical payload + sha256 `version` and republishes the retained /config
// message. The device applies it and round-trips the opaque `version` back as the
// snapshot text `config_version`; the reconcile loop compares desired-vs-applied
// and re-pushes on a mismatch.
//
// Field roles:
//   - `desired` (JSON): the dashboard's intent — an opaque key→value bag. The ONLY
//     field a client writes; never hashed client-side (the server hashes at publish).
//   - `version` (text): the server-computed sha256 hex of the canonical payload,
//     stamped by the publish path. Read-only to clients (server-set via app.Save,
//     which bypasses API rules).
//   - `applied_version` (text): the version the device last reported in its snapshot
//     `config_version`. The reconcile loop re-publishes whenever it != `version`.
//
// `controller` is a denormalized text id (the device id == MQTT topic segment), the
// key the publish/reconcile path joins on, kept as text so it's stable across the
// controller record's lifecycle. Written/maintained server-side by the publish hook
// + IngestSnapshot (app.Save bypasses API rules); the dashboard gets scoped write to
// `desired` on its own sites and read on the rest.
func init() {
	m.Register(func(app core.App) error {
		adminOrSiteOwner := types.Pointer(`@request.auth.id != "" && (@request.auth.role = "admin" || site.owner = @request.auth.id)`)

		sites, err := app.FindCollectionByNameOrId("sites")
		if err != nil {
			return err
		}

		c := core.NewBaseCollection("controller_config")
		c.Fields.Add(
			&core.RelationField{Name: "site", CollectionId: sites.Id, MaxSelect: 1, Required: true, CascadeDelete: true},
			&core.TextField{Name: "controller", Required: true, Max: 100},
			&core.JSONField{Name: "desired", MaxSize: 200_000},
			&core.TextField{Name: "version", Max: 64},
			&core.TextField{Name: "applied_version", Max: 64},
			&core.AutodateField{Name: "created", OnCreate: true},
			&core.AutodateField{Name: "updated", OnCreate: true, OnUpdate: true},
		)
		// One desired-config row per controller — the publish/reconcile join key.
		c.AddIndex("idx_controller_config", true, "controller", "")
		c.ListRule = adminOrSiteOwner
		c.ViewRule = adminOrSiteOwner
		// The dashboard owns the write path: a site owner (or admin) may upsert its
		// own controllers' desired config. The server stamps `version`/`applied_version`
		// via app.Save (which bypasses these rules), so a client can't forge a version.
		c.CreateRule = adminOrSiteOwner
		c.UpdateRule = adminOrSiteOwner
		c.DeleteRule = adminOrSiteOwner
		if err := app.Save(c); err != nil {
			return err
		}

		// Retire the one-shot config_set command (no backward compat): discard the
		// historical rows, drop the action enum value, and remove the config_key/
		// config_value audit fields. Runtime config now flows through controller_config.
		if _, err := app.DB().NewQuery("DELETE FROM commands WHERE action = {:a}").
			Bind(dbx.Params{"a": "config_set"}).Execute(); err != nil {
			return err
		}
		if err := setCommandActionValues(app, commandActionsV37); err != nil {
			return err
		}
		cmds, err := app.FindCollectionByNameOrId("commands")
		if err != nil {
			return err
		}
		cmds.Fields.RemoveByName("config_key")
		cmds.Fields.RemoveByName("config_value")
		return app.Save(cmds)
	}, func(app core.App) error {
		// Restore the config_set enum value + audit fields (rows are not recoverable).
		if err := setCommandActionValues(app, commandActionsV25); err != nil {
			return err
		}
		if cmds, err := app.FindCollectionByNameOrId("commands"); err == nil {
			cmds.Fields.Add(
				&core.TextField{Name: "config_key", Max: 64},
				&core.NumberField{Name: "config_value"},
			)
			if err := app.Save(cmds); err != nil {
				return err
			}
		}
		if c, err := app.FindCollectionByNameOrId("controller_config"); err == nil {
			return app.Delete(c)
		}
		return nil
	})
}
