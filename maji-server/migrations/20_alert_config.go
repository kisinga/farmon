package migrations

import (
	"github.com/pocketbase/pocketbase/core"
	m "github.com/pocketbase/pocketbase/migrations"
)

// Per-site alert thresholds, edited from the dashboard's "Alert thresholds" card
// and read by both the in-app alerts center and the server email sweep. Left
// unset (zero) on existing rows; both readers fall back to defaults (low 20%,
// offline 180s) so a site with no config still alerts sensibly. Owners can edit
// these via the existing adminOrOwner update rule on `sites` — no new rules.
func init() {
	m.Register(func(app core.App) error {
		sites, err := app.FindCollectionByNameOrId("sites")
		if err != nil {
			return err
		}
		sites.Fields.Add(
			&core.NumberField{Name: "tank_low_pct", Min: ptrf(0), Max: ptrf(100)},
			&core.NumberField{Name: "tank_high_pct", Min: ptrf(0), Max: ptrf(100)},
			&core.NumberField{Name: "offline_timeout_s", Min: ptrf(0)},
		)
		return app.Save(sites)
	}, func(app core.App) error {
		sites, err := app.FindCollectionByNameOrId("sites")
		if err != nil {
			return err
		}
		sites.Fields.RemoveByName("tank_low_pct")
		sites.Fields.RemoveByName("tank_high_pct")
		sites.Fields.RemoveByName("offline_timeout_s")
		return app.Save(sites)
	})
}

func ptrf(v float64) *float64 { return &v }
