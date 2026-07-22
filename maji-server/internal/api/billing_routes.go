package api

import (
	"errors"
	"net/http"
	"strings"
	"time"

	"github.com/kisinga/majiflow/internal/billing"
	"github.com/kisinga/majiflow/internal/config"
	"github.com/kisinga/majiflow/internal/metering"
	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/apis"
	"github.com/pocketbase/pocketbase/core"
)

// RegisterBilling mounts the tenant-billing meter routes under
// /api/farmon/billing. Every route requires site access; the mutating ones
// additionally require the site's tenant_billing capability.
func RegisterBilling(se *core.ServeEvent, cfg config.Config) {
	g := se.Router.Group("/api/farmon/billing")

	// GET /capability?site= — feature probe so the UI can gate billing pages.
	g.GET("/capability", func(e *core.RequestEvent) error {
		site := e.Request.URL.Query().Get("site")
		if err := requireSiteAccess(e, site); err != nil {
			return err
		}
		return e.JSON(http.StatusOK, map[string]any{
			"tenant_billing": billing.HasCapability(e.App, site, billing.CapabilityTenantBilling),
		})
	})

	// POST /meters/claim {site, imei, name?, unit?, comm_type?, valve_capable?}
	// — register a meter (usually one seen in meter_sightings) to a site.
	// Idempotent on imei: re-claiming the same site returns the existing row;
	// another site's claim conflicts.
	g.POST("/meters/claim", func(e *core.RequestEvent) error {
		var body struct {
			Site         string `json:"site"`
			IMEI         string `json:"imei"`
			Name         string `json:"name"`
			Unit         string `json:"unit"`
			CommType     string `json:"comm_type"`
			ValveCapable *bool  `json:"valve_capable"`
		}
		if err := e.BindBody(&body); err != nil {
			return apis.NewBadRequestError("invalid body", err)
		}
		if err := requireSiteAccess(e, body.Site); err != nil {
			return err
		}
		if !billing.HasCapability(e.App, body.Site, billing.CapabilityTenantBilling) {
			return apis.NewForbiddenError("tenant_billing capability required", nil)
		}
		body.IMEI = strings.TrimSpace(body.IMEI)
		if body.IMEI == "" {
			return apis.NewBadRequestError("imei is required", nil)
		}

		if existing, _ := e.App.FindFirstRecordByFilter("meter_devices", "imei = {:i}", dbx.Params{"i": body.IMEI}); existing != nil {
			if existing.GetString("site") != body.Site {
				return apis.NewApiError(http.StatusConflict, "meter already claimed to another site", nil)
			}
			return e.JSON(http.StatusOK, meterJSON(existing))
		}

		sighting, _ := e.App.FindFirstRecordByFilter("meter_sightings", "imei = {:i}", dbx.Params{"i": body.IMEI})

		coll, err := e.App.FindCollectionByNameOrId("meter_devices")
		if err != nil {
			return apis.NewApiError(http.StatusInternalServerError, "meter_devices collection missing", err)
		}
		rec := core.NewRecord(coll)
		rec.Set("site", body.Site)
		rec.Set("imei", body.IMEI)
		rec.Set("name", strings.TrimSpace(body.Name))
		if body.Unit != "" {
			rec.Set("unit", body.Unit)
		}
		if sighting != nil {
			rec.Set("sn", sighting.GetString("sn"))
		}
		commType := body.CommType
		if commType == "" {
			commType = "nb_iot"
		}
		switch commType {
		case "nb_iot", "cat1", "rs485", "lorawan":
		default:
			return apis.NewBadRequestError("invalid comm_type", nil)
		}
		rec.Set("comm_type", commType)
		// The Shengda DN20 (LXC-20) has a built-in valve — default capable;
		// valve-less models pass valve_capable: false explicitly.
		valveCapable := true
		if body.ValveCapable != nil {
			valveCapable = *body.ValveCapable
		}
		rec.Set("valve_capable", valveCapable)
		rec.Set("valve_state", "unknown")
		rec.Set("status", "active")
		if err := e.App.Save(rec); err != nil {
			return apis.NewApiError(http.StatusInternalServerError, "failed to claim meter", err)
		}
		if sighting != nil {
			sighting.Set("status", "claimed")
			_ = e.App.Save(sighting)
		}
		return e.JSON(http.StatusOK, meterJSON(rec))
	})

	// POST /meters/{id}/valve {action: "open"|"close", confirm: "OPEN"|"CLOSE"}
	// — queue a valve command for the meter's next contact. The typed
	// confirmation guards against fat-finger actuation; the site is always
	// taken from the meter record, never the body.
	g.POST("/meters/{id}/valve", func(e *core.RequestEvent) error {
		meter, err := e.App.FindRecordById("meter_devices", e.Request.PathValue("id"))
		if err != nil || meter == nil {
			return apis.NewNotFoundError("meter not found", nil)
		}
		if err := requireSiteAccess(e, meter.GetString("site")); err != nil {
			return err
		}
		if !billing.HasCapability(e.App, meter.GetString("site"), billing.CapabilityTenantBilling) {
			return apis.NewForbiddenError("tenant_billing capability required", nil)
		}
		var body struct {
			Action  string `json:"action"`
			Confirm string `json:"confirm"`
		}
		if err := e.BindBody(&body); err != nil {
			return apis.NewBadRequestError("invalid body", err)
		}
		if body.Action != "open" && body.Action != "close" {
			return apis.NewBadRequestError("action must be 'open' or 'close'", nil)
		}
		if body.Confirm != strings.ToUpper(body.Action) {
			return apis.NewBadRequestError("confirmation must match the action ("+strings.ToUpper(body.Action)+")", nil)
		}

		cmd, err := metering.EnqueueValve(e.App, meter, body.Action == "close", e.Auth.Id, e.Auth.GetString("role"))
		if err != nil {
			switch {
			case errors.Is(err, metering.ErrNotValveCapable), errors.Is(err, metering.ErrValveNoChange):
				return apis.NewBadRequestError(err.Error(), nil)
			case errors.Is(err, metering.ErrValvePending):
				return apis.NewApiError(http.StatusConflict, err.Error(), nil)
			default:
				return apis.NewApiError(http.StatusInternalServerError, "failed to queue valve command", err)
			}
		}
		return e.JSON(http.StatusOK, map[string]any{
			"id":     cmd.Id,
			"status": cmd.GetString("status"),
		})
	})

	// GET /meters/{id}/commands — the meter's 50 most recent commands (audit).
	g.GET("/meters/{id}/commands", func(e *core.RequestEvent) error {
		meter, err := e.App.FindRecordById("meter_devices", e.Request.PathValue("id"))
		if err != nil || meter == nil {
			return apis.NewNotFoundError("meter not found", nil)
		}
		if err := requireSiteAccess(e, meter.GetString("site")); err != nil {
			return err
		}
		recs, err := e.App.FindRecordsByFilter("meter_commands", "meter = {:m}", "-created", 50, 0,
			dbx.Params{"m": meter.Id})
		if err != nil {
			return apis.NewApiError(http.StatusInternalServerError, "query failed", err)
		}
		cmds := make([]map[string]any, 0, len(recs))
		for _, r := range recs {
			cmds = append(cmds, meterCommandJSON(r))
		}
		return e.JSON(http.StatusOK, map[string]any{"commands": cmds})
	})

	// POST /payments/manual {site, tenant_account, amount_minor, payer_phone?,
	// reference?, idempotency_key?} — record a cash/bank payment and allocate it
	// oldest-debt-first. idempotency_key makes retries safe (returns the
	// already-booked payment instead of duplicating).
	g.POST("/payments/manual", func(e *core.RequestEvent) error {
		var body struct {
			Site           string `json:"site"`
			TenantAccount  string `json:"tenant_account"`
			AmountMinor    int    `json:"amount_minor"`
			PayerPhone     string `json:"payer_phone"`
			Reference      string `json:"reference"`
			IdempotencyKey string `json:"idempotency_key"`
		}
		if err := e.BindBody(&body); err != nil {
			return apis.NewBadRequestError("invalid body", err)
		}
		if err := requireSiteAccess(e, body.Site); err != nil {
			return err
		}
		if !billing.HasCapability(e.App, body.Site, billing.CapabilityTenantBilling) {
			return apis.NewForbiddenError("tenant_billing capability required", nil)
		}
		if body.TenantAccount == "" {
			return apis.NewBadRequestError("tenant_account is required", nil)
		}
		payment, allocs, err := billing.CreateManualPayment(e.App, body.Site, body.TenantAccount,
			body.AmountMinor, body.PayerPhone, body.Reference, e.Auth.Id, body.IdempotencyKey)
		if err != nil {
			return apis.NewBadRequestError(err.Error(), nil)
		}
		out := make([]map[string]any, 0, len(allocs))
		for _, a := range allocs {
			out = append(out, map[string]any{
				"id":           a.Id,
				"invoice":      a.GetString("invoice"),
				"amount_minor": a.GetInt("amount_minor"),
			})
		}
		return e.JSON(http.StatusOK, map[string]any{
			"id":                payment.Id,
			"processing_status": payment.GetString("processing_status"),
			"allocations":       out,
		})
	})

	// POST /cycles/{id}/issue — flip the cycle's draft invoices to issued and
	// the cycle to issued. Idempotent: an already-issued cycle is a no-op.
	g.POST("/cycles/{id}/issue", func(e *core.RequestEvent) error {
		cycle, err := e.App.FindRecordById("billing_cycles", e.Request.PathValue("id"))
		if err != nil || cycle == nil {
			return apis.NewNotFoundError("cycle not found", nil)
		}
		if err := requireSiteAccess(e, cycle.GetString("site")); err != nil {
			return err
		}
		if !billing.HasCapability(e.App, cycle.GetString("site"), billing.CapabilityTenantBilling) {
			return apis.NewForbiddenError("tenant_billing capability required", nil)
		}
		issued, err := billing.IssueCycle(e.App, cycle, time.Now().UTC())
		if err != nil {
			return apis.NewApiError(http.StatusInternalServerError, "failed to issue cycle", err)
		}
		return e.JSON(http.StatusOK, map[string]any{
			"status": cycle.GetString("status"),
			"issued": issued,
		})
	})
}

// meterJSON is the route response shape for a claimed meter.
func meterJSON(m *core.Record) map[string]any {
	return map[string]any{
		"id":            m.Id,
		"site":          m.GetString("site"),
		"unit":          m.GetString("unit"),
		"imei":          m.GetString("imei"),
		"sn":            m.GetString("sn"),
		"name":          m.GetString("name"),
		"model":         m.GetString("model"),
		"valve_capable": m.GetBool("valve_capable"),
		"valve_state":   m.GetString("valve_state"),
		"status":        m.GetString("status"),
	}
}

// meterCommandJSON is the route response shape for one queued/sent command.
func meterCommandJSON(r *core.Record) map[string]any {
	return map[string]any{
		"id":          r.Id,
		"meter":       r.GetString("meter"),
		"type":        r.GetString("type"),
		"status":      r.GetString("status"),
		"queued_by":   r.GetString("queued_by"),
		"queued_role": r.GetString("queued_role"),
		"sent_at":     r.GetString("sent_at"),
		"acked_at":    r.GetString("acked_at"),
		"error":       r.GetString("error"),
		"created":     r.GetString("created"),
	}
}
