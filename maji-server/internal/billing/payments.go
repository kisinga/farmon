package billing

import (
	"fmt"
	"time"

	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tools/security"
)

// CreateManualPayment records a cash/bank payment against a tenant account and
// allocates it oldest-debt-first (architecture §8.3: allocation happens within
// the KNOWN account only — never cross-account). The unallocated remainder
// stays on the payment as credit (processing_status partially_allocated).
//
// idempotencyKey is optional but recommended: when present it becomes the
// provider_transaction_id, so a retried request returns the EXISTING payment
// instead of booking a duplicate (architecture §10: financial commands that
// may be retried require idempotency keys).
func CreateManualPayment(app core.App, siteID, tenantAccountID string, amountMinor int, payerPhone, reference, actorID, idempotencyKey string) (*core.Record, []*core.Record, error) {
	if amountMinor <= 0 {
		return nil, nil, fmt.Errorf("amount_minor must be positive")
	}
	account, err := app.FindRecordById("tenant_accounts", tenantAccountID)
	if err != nil || account == nil {
		return nil, nil, fmt.Errorf("tenant account not found")
	}
	if account.GetString("site") != siteID {
		return nil, nil, fmt.Errorf("tenant account does not belong to the site")
	}

	txnID := "manual-" + security.RandomString(12)
	if idempotencyKey != "" {
		txnID = idempotencyKey
		existing, _ := app.FindFirstRecordByFilter("payment_transactions",
			"provider = 'manual' && provider_transaction_id = {:t}", dbx.Params{"t": txnID})
		if existing != nil {
			// Retry of an already-booked payment: return it as-is, no re-allocation.
			allocs, _ := app.FindRecordsByFilter("payment_allocations",
				"payment = {:p}", "", 100, 0, dbx.Params{"p": existing.Id})
			return existing, allocs, nil
		}
	}

	currency := "KES"
	if settings, _ := app.FindFirstRecordByFilter("billing_settings", "site = {:s}", dbx.Params{"s": siteID}); settings != nil {
		if c := settings.GetString("currency"); c != "" {
			currency = c
		}
	}

	coll, err := app.FindCollectionByNameOrId("payment_transactions")
	if err != nil {
		return nil, nil, err
	}
	payment := core.NewRecord(coll)
	payment.Set("site", siteID)
	payment.Set("tenant_account", tenantAccountID)
	payment.Set("provider", "manual")
	// The (provider, provider_transaction_id) unique index doubles as the
	// idempotency anchor for retries.
	payment.Set("provider_transaction_id", txnID)
	payment.Set("amount_minor", amountMinor)
	payment.Set("currency", currency)
	payment.Set("payer_phone", payerPhone)
	payment.Set("reference", reference)
	payment.Set("received_at", time.Now().UTC())
	payment.Set("processing_status", "unallocated")
	if err := app.Save(payment); err != nil {
		return nil, nil, err
	}

	allocs, err := AllocatePayment(app, payment, actorID)
	if err != nil {
		return payment, nil, err
	}
	return payment, allocs, nil
}

// AllocatePayment applies a payment's unallocated remainder to the account's
// outstanding invoices, oldest due date first. Invoice status transitions:
// issued|overdue → partially_paid → paid (allocated >= total). After
// allocation the arrears state is re-evaluated (a covered arrears triggers
// valve reopen). Transactional.
func AllocatePayment(app core.App, payment *core.Record, allocatedBy string) ([]*core.Record, error) {
	var allocs []*core.Record
	err := app.RunInTransaction(func(txApp core.App) error {
		accountID := payment.GetString("tenant_account")
		already := sumAllocations(txApp, "payment = {:p}", dbx.Params{"p": payment.Id})
		remainder := int64(payment.GetInt("amount_minor")) - already
		if remainder <= 0 {
			return nil
		}

		// Outstanding = anything issued and not yet fully settled, oldest first.
		open, err := txApp.FindRecordsByFilter("invoices",
			"tenant_account = {:a} && (status = 'issued' || status = 'partially_paid' || status = 'overdue')",
			"due_date", 100, 0, dbx.Params{"a": accountID})
		if err != nil {
			return err
		}

		coll, err := txApp.FindCollectionByNameOrId("payment_allocations")
		if err != nil {
			return err
		}
		for _, inv := range open {
			if remainder <= 0 {
				break
			}
			balance := int64(inv.GetInt("total_minor")) - int64(inv.GetInt("allocated_minor"))
			if balance <= 0 {
				continue
			}
			amount := min(remainder, balance)

			alloc := core.NewRecord(coll)
			alloc.Set("site", payment.GetString("site"))
			alloc.Set("payment", payment.Id)
			alloc.Set("invoice", inv.Id)
			alloc.Set("amount_minor", amount)
			alloc.Set("allocated_at", time.Now().UTC())
			alloc.Set("allocated_by", allocatedBy)
			if err := txApp.Save(alloc); err != nil {
				return err
			}
			allocs = append(allocs, alloc)

			newAllocated := int64(inv.GetInt("allocated_minor")) + amount
			inv.Set("allocated_minor", newAllocated)
			if newAllocated >= int64(inv.GetInt("total_minor")) {
				inv.Set("status", "paid")
			} else {
				inv.Set("status", "partially_paid")
			}
			if err := txApp.Save(inv); err != nil {
				return err
			}
			remainder -= amount
		}

		// Post-allocation status: fully applied → allocated; any remainder is
		// credit held on the payment → partially_allocated (a payment that has
		// been through allocation never reads "unallocated").
		if remainder <= 0 {
			payment.Set("processing_status", "allocated")
		} else {
			payment.Set("processing_status", "partially_allocated")
		}
		return txApp.Save(payment)
	})
	if err != nil {
		return allocs, err
	}
	if len(allocs) > 0 {
		ReevaluateAfterPayment(app, payment.GetString("tenant_account"))
	}
	return allocs, nil
}

// sumAllocations totals allocation amounts matching a filter.
func sumAllocations(app core.App, filter string, params dbx.Params) int64 {
	var row struct {
		Total int64 `db:"total"`
	}
	if err := app.DB().NewQuery("SELECT COALESCE(SUM(amount_minor), 0) AS total FROM payment_allocations WHERE " + filter).
		Bind(params).One(&row); err != nil {
		return 0
	}
	return row.Total
}

// IssueCycle flips a prepared cycle's draft invoices to issued and the cycle
// itself to issued. Idempotent: an already-issued cycle reports 0 new issues.
func IssueCycle(app core.App, cycle *core.Record, now time.Time) (int, error) {
	if cycle.GetString("status") == "issued" {
		return 0, nil
	}
	drafts, err := app.FindRecordsByFilter("invoices",
		"cycle = {:c} && status = 'draft'", "", 500, 0, dbx.Params{"c": cycle.Id})
	if err != nil {
		return 0, err
	}
	err = app.RunInTransaction(func(txApp core.App) error {
		for _, inv := range drafts {
			inv.Set("status", "issued")
			inv.Set("issued_at", now)
			inv.Set("due_date", cycle.GetDateTime("due_date").Time())
			if err := txApp.Save(inv); err != nil {
				return err
			}
		}
		cycle.Set("status", "issued")
		return txApp.Save(cycle)
	})
	if err != nil {
		return 0, err
	}
	return len(drafts), nil
}
