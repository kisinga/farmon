package migrations

import (
	"github.com/pocketbase/pocketbase/core"
	m "github.com/pocketbase/pocketbase/migrations"
	"github.com/pocketbase/pocketbase/tools/types"
)

// Tenant-billing core (architecture §4.1/§4.3, trimmed for the Shengda path):
// billable units, the people who pay, temporal liability, per-site policy, and
// versioned tariffs. Financial records (invoices, payments) land in migration 59;
// the meters themselves in 58.
//
// Money is integer minor units (KES cents), usage integer millilitres — see the
// architecture doc §5 invariants. Rules follow the repo's multi-owner semantics:
// owners manage master data on their own sites; tenant contacts get NO direct
// collection access.
func init() {
	m.Register(func(app core.App) error {
		adminOrSiteOwner := types.Pointer(`@request.auth.id != "" && (@request.auth.role = "admin" || site.owner = @request.auth.id)`)
		adminOnly := types.Pointer(`@request.auth.role = "admin"`)

		sites, err := app.FindCollectionByNameOrId("sites")
		if err != nil {
			return err
		}

		units := core.NewBaseCollection("billing_units")
		units.Fields.Add(
			&core.RelationField{Name: "site", CollectionId: sites.Id, MaxSelect: 1, Required: true},
			&core.TextField{Name: "code", Required: true, Max: 60},
			&core.TextField{Name: "name", Max: 200},
			&core.SelectField{Name: "status", Values: []string{"active", "vacant", "archived"}, MaxSelect: 1},
			&core.AutodateField{Name: "created", OnCreate: true},
			&core.AutodateField{Name: "updated", OnCreate: true, OnUpdate: true},
		)
		units.AddIndex("idx_billing_units_site_code", true, "site,code", "")
		units.ListRule = adminOrSiteOwner
		units.ViewRule = adminOrSiteOwner
		units.CreateRule = adminOrSiteOwner
		units.UpdateRule = adminOrSiteOwner
		units.DeleteRule = adminOnly
		if err := app.Save(units); err != nil {
			return err
		}

		tenants := core.NewBaseCollection("tenant_accounts")
		tenants.Fields.Add(
			&core.RelationField{Name: "site", CollectionId: sites.Id, MaxSelect: 1, Required: true},
			&core.TextField{Name: "account_number", Required: true, Max: 60},
			&core.TextField{Name: "name", Required: true, Max: 200},
			&core.TextField{Name: "phone", Max: 40},
			&core.EmailField{Name: "email"},
			&core.SelectField{Name: "status", Values: []string{"active", "inactive"}, MaxSelect: 1},
			&core.TextField{Name: "notes", Max: 2000},
			&core.AutodateField{Name: "created", OnCreate: true},
			&core.AutodateField{Name: "updated", OnCreate: true, OnUpdate: true},
		)
		tenants.AddIndex("idx_tenant_accounts_site_number", true, "site,account_number", "")
		tenants.ListRule = adminOrSiteOwner
		tenants.ViewRule = adminOrSiteOwner
		tenants.CreateRule = adminOrSiteOwner
		tenants.UpdateRule = adminOrSiteOwner
		tenants.DeleteRule = adminOnly
		if err := app.Save(tenants); err != nil {
			return err
		}

		// Occupancy is temporal liability: invoice generation resolves WHO pays
		// from here, never from mutable "current tenant" state on a meter/unit.
		occupancies := core.NewBaseCollection("occupancies")
		occupancies.Fields.Add(
			&core.RelationField{Name: "site", CollectionId: sites.Id, MaxSelect: 1, Required: true},
			&core.RelationField{Name: "unit", CollectionId: units.Id, MaxSelect: 1, Required: true},
			&core.RelationField{Name: "tenant_account", CollectionId: tenants.Id, MaxSelect: 1, Required: true},
			&core.DateField{Name: "liable_from"},
			&core.DateField{Name: "liable_until"}, // zero = still liable
			&core.NumberField{Name: "move_in_reading_ml", OnlyInt: true},
			&core.NumberField{Name: "move_out_reading_ml", OnlyInt: true},
			&core.SelectField{Name: "status", Values: []string{"active", "ended"}, MaxSelect: 1},
			&core.AutodateField{Name: "created", OnCreate: true},
			&core.AutodateField{Name: "updated", OnCreate: true, OnUpdate: true},
		)
		occupancies.AddIndex("idx_occupancies_unit", false, "unit,liable_from", "")
		occupancies.ListRule = adminOrSiteOwner
		occupancies.ViewRule = adminOrSiteOwner
		occupancies.CreateRule = adminOrSiteOwner
		occupancies.UpdateRule = adminOrSiteOwner
		occupancies.DeleteRule = adminOnly
		if err := app.Save(occupancies); err != nil {
			return err
		}

		// Per-site billing policy, including the arrears→valve automation knobs.
		settings := core.NewBaseCollection("billing_settings")
		settings.Fields.Add(
			&core.RelationField{Name: "site", CollectionId: sites.Id, MaxSelect: 1, Required: true},
			&core.TextField{Name: "timezone", Max: 60},        // IANA, e.g. "Africa/Nairobi"
			&core.NumberField{Name: "due_day", OnlyInt: true}, // day of month invoices fall due
			&core.NumberField{Name: "grace_days", OnlyInt: true},
			&core.NumberField{Name: "warn_days", OnlyInt: true},
			&core.BoolField{Name: "auto_valve_enabled"},
			&core.TextField{Name: "currency", Max: 3}, // "KES"
			&core.AutodateField{Name: "created", OnCreate: true},
			&core.AutodateField{Name: "updated", OnCreate: true, OnUpdate: true},
		)
		settings.AddIndex("idx_billing_settings_site", true, "site", "")
		settings.ListRule = adminOrSiteOwner
		settings.ViewRule = adminOrSiteOwner
		settings.CreateRule = adminOrSiteOwner
		settings.UpdateRule = adminOrSiteOwner
		settings.DeleteRule = adminOnly
		if err := app.Save(settings); err != nil {
			return err
		}

		// Versioned charge definitions. Values billed onto an invoice are COPIED
		// onto its line items; later tariff edits must not alter history.
		tariffs := core.NewBaseCollection("tariffs")
		tariffs.Fields.Add(
			&core.RelationField{Name: "site", CollectionId: sites.Id, MaxSelect: 1, Required: true},
			&core.TextField{Name: "name", Required: true, Max: 120},
			&core.DateField{Name: "effective_from"},
			&core.DateField{Name: "effective_until"}, // zero = open-ended
			&core.NumberField{Name: "rate_per_kl_minor", OnlyInt: true},
			&core.NumberField{Name: "standing_charge_minor", OnlyInt: true},
			&core.NumberField{Name: "minimum_charge_minor", OnlyInt: true},
			&core.NumberField{Name: "tax_bps", OnlyInt: true},
			&core.SelectField{Name: "status", Values: []string{"active", "retired"}, MaxSelect: 1},
			&core.AutodateField{Name: "created", OnCreate: true},
			&core.AutodateField{Name: "updated", OnCreate: true, OnUpdate: true},
		)
		tariffs.AddIndex("idx_tariffs_site", false, "site,effective_from", "")
		tariffs.ListRule = adminOrSiteOwner
		tariffs.ViewRule = adminOrSiteOwner
		tariffs.CreateRule = adminOrSiteOwner
		tariffs.UpdateRule = adminOrSiteOwner
		tariffs.DeleteRule = adminOnly
		return app.Save(tariffs)
	}, func(app core.App) error {
		for _, name := range []string{"tariffs", "billing_settings", "occupancies", "tenant_accounts", "billing_units"} {
			if c, err := app.FindCollectionByNameOrId(name); err == nil {
				if err := app.Delete(c); err != nil {
					return err
				}
			}
		}
		return nil
	})
}
