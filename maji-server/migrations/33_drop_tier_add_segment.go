package migrations

import (
	"github.com/pocketbase/pocketbase/core"
	m "github.com/pocketbase/pocketbase/migrations"
)

// A site's commercial shape splits into three independent concerns; this migration
// lands the two stored ones on `sites` and retires the conflated `tier`:
//
//   - segment: what the site is FOR (farm / property / water_supply). Drives the
//     dashboard skin and which pack gets pitched. A default, never a feature gate.
//   - price_override: an explicit bespoke price (0 = none), replacing the magic
//     `tier=custom` value that used to carry that meaning implicitly.
//   - addons: a-la-carte capability keys granted directly to the site.
//
// The old `tier` (lite/pro/custom) is dropped: nothing ever read it. Size (the
// price/quota axis) is derived from device count and the hosting cap already
// enforces it (capReactivation), so it needs no stored field. Features come only
// from packs + addons (migration 34), never from size or segment.
func init() {
	m.Register(func(app core.App) error {
		sites, err := app.FindCollectionByNameOrId("sites")
		if err != nil {
			return err
		}
		sites.Fields.RemoveByName("tier")
		sites.Fields.Add(
			&core.SelectField{Name: "segment", Values: []string{"farm", "property", "water_supply"}, MaxSelect: 1},
			&core.NumberField{Name: "price_override"},
			&core.JSONField{Name: "addons", MaxSize: 100_000},
		)
		return app.Save(sites)
	}, func(app core.App) error {
		sites, err := app.FindCollectionByNameOrId("sites")
		if err != nil {
			return err
		}
		sites.Fields.RemoveByName("segment")
		sites.Fields.RemoveByName("price_override")
		sites.Fields.RemoveByName("addons")
		sites.Fields.Add(
			&core.SelectField{Name: "tier", Values: []string{"lite", "pro", "custom"}, MaxSelect: 1},
		)
		return app.Save(sites)
	})
}
