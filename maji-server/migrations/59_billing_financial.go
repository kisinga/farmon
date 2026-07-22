package migrations

import (
	"github.com/pocketbase/pocketbase/core"
	m "github.com/pocketbase/pocketbase/migrations"
	"github.com/pocketbase/pocketbase/tools/types"
)

// Billing financial spine (architecture §4.3/§4.4/§4.5, trimmed for v1):
// cycles → immutable invoices/lines → payments/allocations, plus the job-run
// audit ledger the scheduler writes. No M-Pesa, no PDFs yet.
//
// All financial mutations happen server-side through custom routes and jobs
// (app.Save bypasses API rules); customers get read-only access scoped to
// their sites. Issued invoice contents are immutable: corrections are new
// payments/allocations, never edits.
func init() {
	m.Register(func(app core.App) error {
		adminOrSiteOwner := types.Pointer(`@request.auth.id != "" && (@request.auth.role = "admin" || site.owner = @request.auth.id)`)
		adminOnly := types.Pointer(`@request.auth.role = "admin"`)

		sites, err := app.FindCollectionByNameOrId("sites")
		if err != nil {
			return err
		}
		tenants, err := app.FindCollectionByNameOrId("tenant_accounts")
		if err != nil {
			return err
		}
		meters, err := app.FindCollectionByNameOrId("meter_devices")
		if err != nil {
			return err
		}
		occupancies, err := app.FindCollectionByNameOrId("occupancies")
		if err != nil {
			return err
		}

		cycles := core.NewBaseCollection("billing_cycles")
		cycles.Fields.Add(
			&core.RelationField{Name: "site", CollectionId: sites.Id, MaxSelect: 1, Required: true},
			&core.DateField{Name: "period_start"},
			&core.DateField{Name: "period_end"},
			&core.DateField{Name: "due_date"},
			&core.SelectField{Name: "status", Values: []string{"open", "prepared", "issued", "closed"}, MaxSelect: 1},
			&core.DateField{Name: "generated_at"},
			&core.AutodateField{Name: "created", OnCreate: true},
			&core.AutodateField{Name: "updated", OnCreate: true, OnUpdate: true},
		)
		cycles.AddIndex("idx_billing_cycles_site_period", true, "site,period_start,period_end", "")
		cycles.ListRule = adminOrSiteOwner
		cycles.ViewRule = adminOrSiteOwner
		cycles.CreateRule = adminOnly
		cycles.UpdateRule = adminOnly
		cycles.DeleteRule = adminOnly
		if err := app.Save(cycles); err != nil {
			return err
		}

		invoices := core.NewBaseCollection("invoices")
		invoices.Fields.Add(
			&core.RelationField{Name: "site", CollectionId: sites.Id, MaxSelect: 1, Required: true, CascadeDelete: false},
			&core.RelationField{Name: "tenant_account", CollectionId: tenants.Id, MaxSelect: 1, Required: true},
			&core.RelationField{Name: "cycle", CollectionId: cycles.Id, MaxSelect: 1, Required: true},
			&core.TextField{Name: "invoice_number", Required: true, Max: 40},
			&core.TextField{Name: "currency", Max: 3},
			&core.NumberField{Name: "subtotal_minor", OnlyInt: true},
			&core.NumberField{Name: "tax_minor", OnlyInt: true},
			&core.NumberField{Name: "total_minor", OnlyInt: true},
			&core.NumberField{Name: "allocated_minor", OnlyInt: true}, // denormalized payment total, maintained by allocation writes
			&core.SelectField{Name: "status", Values: []string{"draft", "issued", "partially_paid", "paid", "overdue", "disputed", "written_off"}, MaxSelect: 1},
			&core.DateField{Name: "issued_at"},
			&core.DateField{Name: "due_date"},
			&core.DateField{Name: "warned_at"}, // arrears warning sent (idempotency anchor)
			&core.DateField{Name: "closed_at"}, // valve closed for arrears (idempotency anchor)
			&core.AutodateField{Name: "created", OnCreate: true},
			&core.AutodateField{Name: "updated", OnCreate: true, OnUpdate: true},
		)
		invoices.AddIndex("idx_invoices_site_number", true, "site,invoice_number", "")
		invoices.AddIndex("idx_invoices_cycle_tenant", true, "cycle,tenant_account", "")
		invoices.AddIndex("idx_invoices_status", false, "site,status,due_date", "")
		invoices.ListRule = adminOrSiteOwner
		invoices.ViewRule = adminOrSiteOwner
		invoices.CreateRule = adminOnly
		invoices.UpdateRule = adminOnly
		invoices.DeleteRule = adminOnly
		if err := app.Save(invoices); err != nil {
			return err
		}

		lines := core.NewBaseCollection("invoice_lines")
		lines.Fields.Add(
			&core.RelationField{Name: "site", CollectionId: sites.Id, MaxSelect: 1, Required: true, CascadeDelete: false},
			&core.RelationField{Name: "invoice", CollectionId: invoices.Id, MaxSelect: 1, Required: true, CascadeDelete: true},
			&core.SelectField{Name: "type", Values: []string{"usage", "standing_charge", "minimum_charge", "tax", "credit", "correction"}, MaxSelect: 1},
			&core.TextField{Name: "description", Max: 300},
			&core.NumberField{Name: "quantity_ml", OnlyInt: true},
			&core.NumberField{Name: "unit_price_minor", OnlyInt: true},
			&core.NumberField{Name: "amount_minor", OnlyInt: true},
			&core.RelationField{Name: "meter", CollectionId: meters.Id, MaxSelect: 1},
			&core.RelationField{Name: "occupancy", CollectionId: occupancies.Id, MaxSelect: 1},
			&core.SelectField{Name: "quality", Values: []string{"actual", "estimated"}, MaxSelect: 1},
			&core.AutodateField{Name: "created", OnCreate: true},
		)
		lines.AddIndex("idx_invoice_lines_invoice", false, "invoice", "")
		lines.ListRule = adminOrSiteOwner
		lines.ViewRule = adminOrSiteOwner
		lines.CreateRule = adminOnly
		lines.UpdateRule = adminOnly
		lines.DeleteRule = adminOnly
		if err := app.Save(lines); err != nil {
			return err
		}

		payments := core.NewBaseCollection("payment_transactions")
		payments.Fields.Add(
			&core.RelationField{Name: "site", CollectionId: sites.Id, MaxSelect: 1, Required: true, CascadeDelete: false},
			&core.RelationField{Name: "tenant_account", CollectionId: tenants.Id, MaxSelect: 1, Required: true},
			&core.SelectField{Name: "provider", Values: []string{"manual", "mpesa"}, MaxSelect: 1, Required: true},
			&core.TextField{Name: "provider_transaction_id", Max: 120},
			&core.NumberField{Name: "amount_minor", OnlyInt: true, Required: true},
			&core.TextField{Name: "currency", Max: 3},
			&core.TextField{Name: "payer_phone", Max: 40},
			&core.TextField{Name: "reference", Max: 200},
			&core.DateField{Name: "received_at"},
			&core.SelectField{Name: "processing_status", Values: []string{"unallocated", "partially_allocated", "allocated", "reversed"}, MaxSelect: 1},
			&core.JSONField{Name: "raw_payload", MaxSize: 100_000},
			&core.AutodateField{Name: "created", OnCreate: true},
			&core.AutodateField{Name: "updated", OnCreate: true, OnUpdate: true},
		)
		payments.AddIndex("idx_payments_provider_txn", true, "provider,provider_transaction_id", "")
		payments.ListRule = adminOrSiteOwner
		payments.ViewRule = adminOrSiteOwner
		payments.CreateRule = adminOnly
		payments.UpdateRule = adminOnly
		payments.DeleteRule = adminOnly
		if err := app.Save(payments); err != nil {
			return err
		}

		allocations := core.NewBaseCollection("payment_allocations")
		allocations.Fields.Add(
			&core.RelationField{Name: "site", CollectionId: sites.Id, MaxSelect: 1, Required: true, CascadeDelete: false},
			&core.RelationField{Name: "payment", CollectionId: payments.Id, MaxSelect: 1, Required: true},
			&core.RelationField{Name: "invoice", CollectionId: invoices.Id, MaxSelect: 1, Required: true},
			&core.NumberField{Name: "amount_minor", OnlyInt: true, Required: true},
			&core.DateField{Name: "allocated_at"},
			&core.TextField{Name: "allocated_by", Max: 100}, // user id or "rule:auto"
			&core.AutodateField{Name: "created", OnCreate: true},
		)
		allocations.AddIndex("idx_allocations_invoice", false, "invoice", "")
		allocations.AddIndex("idx_allocations_payment", false, "payment", "")
		allocations.ListRule = adminOrSiteOwner
		allocations.ViewRule = adminOrSiteOwner
		allocations.CreateRule = adminOnly
		allocations.UpdateRule = adminOnly
		allocations.DeleteRule = adminOnly
		if err := app.Save(allocations); err != nil {
			return err
		}
		// Self-relation can only be added once the collection (and its id) exists.
		allocations.Fields.Add(
			&core.RelationField{Name: "reversal_of", CollectionId: allocations.Id, MaxSelect: 1},
		)
		if err := app.Save(allocations); err != nil {
			return err
		}

		// Scheduler audit + idempotency anchor for billing jobs.
		jobs := core.NewBaseCollection("billing_job_runs")
		jobs.Fields.Add(
			&core.RelationField{Name: "site", CollectionId: sites.Id, MaxSelect: 1},
			&core.TextField{Name: "job_type", Required: true, Max: 60},
			&core.TextField{Name: "business_key", Required: true, Max: 200},
			&core.SelectField{Name: "status", Values: []string{"running", "succeeded", "failed"}, MaxSelect: 1},
			&core.NumberField{Name: "attempt", OnlyInt: true},
			&core.DateField{Name: "started_at"},
			&core.DateField{Name: "finished_at"},
			&core.TextField{Name: "error", Max: 1000},
			&core.AutodateField{Name: "created", OnCreate: true},
		)
		jobs.AddIndex("idx_billing_job_runs_key", true, "job_type,business_key", "")
		jobs.ListRule = adminOnly
		jobs.ViewRule = adminOnly
		jobs.CreateRule = adminOnly
		jobs.UpdateRule = adminOnly
		jobs.DeleteRule = adminOnly
		return app.Save(jobs)
	}, func(app core.App) error {
		for _, name := range []string{"billing_job_runs", "payment_allocations", "payment_transactions", "invoice_lines", "invoices", "billing_cycles"} {
			if c, err := app.FindCollectionByNameOrId(name); err == nil {
				if err := app.Delete(c); err != nil {
					return err
				}
			}
		}
		return nil
	})
}
