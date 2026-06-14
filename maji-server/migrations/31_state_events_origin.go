package migrations

import (
	"github.com/pocketbase/pocketbase/core"
	m "github.com/pocketbase/pocketbase/migrations"
)

// state_events gains origin / actor / actor_label so a derived transition records
// who/what caused it — the same attribution the route snapshot already carries.
// Without these the activity timeline can show "who" for operator commands (the
// commands ledger) but not for routes, so an automation-started run is anonymous.
// `actor` is the whole id (user id for MANUAL, automation id for AUTOMATION);
// `actor_label` is the display name the ingest resolves once (resolveActorLabel),
// mirroring how the controller_state snapshot stores it. Populated at the single
// derivation site (telemetry.appendDerivedEvent); read by the dashboard timeline.
func init() {
	m.Register(func(app core.App) error {
		c, err := app.FindCollectionByNameOrId("state_events")
		if err != nil {
			return err
		}
		c.Fields.Add(
			&core.TextField{Name: "origin", Max: 40},
			&core.TextField{Name: "actor", Max: 100},
			&core.TextField{Name: "actor_label", Max: 200},
		)
		return app.Save(c)
	}, func(app core.App) error {
		c, err := app.FindCollectionByNameOrId("state_events")
		if err != nil {
			return err
		}
		c.Fields.RemoveByName("origin")
		c.Fields.RemoveByName("actor")
		c.Fields.RemoveByName("actor_label")
		return app.Save(c)
	})
}
