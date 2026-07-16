package migrations

import (
	"encoding/json"

	"github.com/pocketbase/pocketbase/core"
	m "github.com/pocketbase/pocketbase/migrations"
	"github.com/pocketbase/pocketbase/tools/types"
)

// `notification_templates` — operator-editable copy for outbound notifications.
// The alerts sweeper renders an active row matching (key, channel) with Go
// text/template and falls back to its built-in strings when no row exists (or
// the render fails), so editing copy is a data change, not a deploy — and a
// broken template can never silence an alert. Keys mirror the
// notification_prefs field naming ("alert_" + kind). `variables` documents the
// placeholders each key is rendered with; it is not read by code.
//
// Seeded with the exact built-in copy for the alert kinds the sweeper sends
// today (rendered output is byte-identical to the hardcoded strings), plus the
// billing keys the customer-billing module will send.
func init() {
	type seed struct {
		key       string
		subject   string
		body      string
		variables []string
	}
	seeds := []seed{
		{"alert_device_offline", "Controller offline",
			`{{.controller}} on {{.site}} has gone offline (last seen {{.last_seen}}).`,
			[]string{"controller", "site", "last_seen"}},
		{"alert_device_online", "Controller back online",
			`{{.controller}} on {{.site}} is back online{{if .duration}} after {{.duration}}{{end}}.`,
			[]string{"controller", "site", "duration"}},
		{"alert_fault", "Fault",
			`{{.controller}} on {{.site}} reported a fault: {{.reason}}.`,
			[]string{"controller", "site", "reason"}},
		{"alert_tank_low", "Tank low",
			`{{.tank}} on {{.site}} is at {{.pct}}% (low threshold {{.threshold}}%).`,
			[]string{"tank", "site", "pct", "threshold"}},
		{"alert_tank_high", "Tank full",
			`{{.tank}} on {{.site}} is at {{.pct}}% (high threshold {{.threshold}}%).`,
			[]string{"tank", "site", "pct", "threshold"}},
		{"alert_run_start", "Run started",
			`Route {{.route}} on {{.site}} at {{.controller}} has started running.`,
			[]string{"route", "site", "controller"}},
		{"alert_run_stop", "Run stopped",
			`Route {{.route}} on {{.site}} at {{.controller}} stopped ({{.reason}}).`,
			[]string{"route", "site", "controller", "reason"}},
		{"alert_command_failed", "Command failed",
			`{{.command}} on {{.site}} at {{.controller}} failed: {{.reason}}.`,
			[]string{"command", "site", "controller", "reason"}},
		{"invoice_issued", `Invoice {{.invoice_no}}`,
			`Hello {{.customer}}, your invoice {{.invoice_no}} for KES {{.amount}} is due {{.due_date}}. Pay via M-Pesa Paybill {{.paybill}}, account {{.account}}.`,
			[]string{"customer", "invoice_no", "amount", "due_date", "paybill", "account"}},
		{"payment_reminder", `Payment reminder: {{.invoice_no}}`,
			`Hello {{.customer}}, invoice {{.invoice_no}} for KES {{.amount}} was due {{.due_date}} and is still unpaid. Pay via M-Pesa Paybill {{.paybill}}, account {{.account}}.`,
			[]string{"customer", "invoice_no", "amount", "due_date", "paybill", "account"}},
		{"payment_received", "Payment received",
			`Hello {{.customer}}, we received KES {{.amount}} for invoice {{.invoice_no}}. Thank you.`,
			[]string{"customer", "invoice_no", "amount"}},
	}

	m.Register(func(app core.App) error {
		adminOnly := types.Pointer(`@request.auth.role = "admin"`)
		c := core.NewBaseCollection("notification_templates")
		c.Fields.Add(
			&core.TextField{Name: "key", Required: true, Max: 80},
			&core.SelectField{Name: "channel", Required: true, Values: []string{"whatsapp", "email", "sms"}, MaxSelect: 1},
			&core.TextField{Name: "subject", Max: 200},
			&core.TextField{Name: "body", Required: true, Max: 2000},
			&core.JSONField{Name: "variables", MaxSize: 10_000},
			&core.BoolField{Name: "active"},
			&core.AutodateField{Name: "created", OnCreate: true},
			&core.AutodateField{Name: "updated", OnCreate: true, OnUpdate: true},
		)
		c.AddIndex("idx_notification_templates_key_channel", true, "key, channel", "")
		c.ListRule = adminOnly
		c.ViewRule = adminOnly
		c.CreateRule = adminOnly
		c.UpdateRule = adminOnly
		c.DeleteRule = adminOnly
		if err := app.Save(c); err != nil {
			return err
		}

		// Seed the built-in copy for both live channels so the operator edits
		// rows instead of writing them from scratch.
		for _, s := range seeds {
			vars, err := json.Marshal(s.variables)
			if err != nil {
				return err
			}
			for _, channel := range []string{"whatsapp", "email"} {
				rec := core.NewRecord(c)
				rec.Set("key", s.key)
				rec.Set("channel", channel)
				rec.Set("subject", s.subject)
				rec.Set("body", s.body)
				rec.Set("variables", string(vars))
				rec.Set("active", true)
				if err := app.Save(rec); err != nil {
					return err
				}
			}
		}
		return nil
	}, func(app core.App) error {
		c, err := app.FindCollectionByNameOrId("notification_templates")
		if err != nil {
			return err
		}
		return app.Delete(c)
	})
}
