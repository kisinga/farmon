// Package api mounts the domain-agnostic /api/farmon route group.
package api

import (
	"encoding/json"
	"net/http"
	"time"

	"github.com/kisinga/majiflow/internal/config"
	"github.com/kisinga/majiflow/internal/telemetry"
	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/apis"
	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tools/security"
)

// Publisher is the subset of the MQTT broker the command endpoint needs.
// The Mochi *server.Server satisfies it (InlineClient must be enabled).
type Publisher interface {
	Publish(topic string, payload []byte, retain bool, qos byte) error
}

// commandActions mirrors CommandAction in src/lib/codegen-ids.ts.
var commandActions = map[string]bool{
	"route_start": true, "route_stop": true, "fault_reset": true,
	"stop_all": true, "reset_faults": true, "clear_queue": true,
}

// routeActions are the commands that require a route_id.
var routeActions = map[string]bool{
	"route_start": true, "route_stop": true, "fault_reset": true,
}

// Register mounts the /api/farmon routes on the serve event's router.
func Register(se *core.ServeEvent, cfg config.Config, pub Publisher) {
	g := se.Router.Group("/api/farmon")

	g.GET("/health", func(e *core.RequestEvent) error {
		return e.JSON(http.StatusOK, map[string]any{
			"status": "ok",
			"mode":   string(cfg.Mode),
		})
	})

	// GET /latest?site=&controller= — the device shadow (last-known per sensor).
	g.GET("/latest", func(e *core.RequestEvent) error {
		q := e.Request.URL.Query()
		site := q.Get("site")
		if err := requireSiteAccess(e, site); err != nil {
			return err
		}
		filter := "site = {:s}"
		params := dbx.Params{"s": site}
		if ctrl := q.Get("controller"); ctrl != "" {
			filter += " && controller = {:c}"
			params["c"] = ctrl
		}
		recs, err := e.App.FindRecordsByFilter("entity_state", filter, "controller,sensor", 5000, 0, params)
		if err != nil {
			return apis.NewBadRequestError("query failed", err)
		}
		out := make([]map[string]any, 0, len(recs))
		for _, r := range recs {
			out = append(out, map[string]any{
				"controller":    r.GetString("controller"),
				"sensor":        r.GetString("sensor"),
				"reported":      r.GetFloat("reported"),
				"reported_text": r.GetString("reported_text"),
				"desired":       r.GetFloat("desired"),
				"ts":            r.GetString("ts"),
			})
		}
		return e.JSON(http.StatusOK, out)
	})

	// GET /telemetry?site=&controller=&sensor=&from=&to= — history, with the
	// storage tier (raw / 5min / 1hr) chosen from the requested span.
	g.GET("/telemetry", func(e *core.RequestEvent) error {
		q := e.Request.URL.Query()
		site := q.Get("site")
		if err := requireSiteAccess(e, site); err != nil {
			return err
		}
		ctrl, sensor := q.Get("controller"), q.Get("sensor")
		if ctrl == "" || sensor == "" {
			return apis.NewBadRequestError("controller and sensor are required", nil)
		}
		from, err := time.Parse(time.RFC3339, q.Get("from"))
		if err != nil {
			return apis.NewBadRequestError("invalid 'from' (RFC3339)", nil)
		}
		to, err := time.Parse(time.RFC3339, q.Get("to"))
		if err != nil {
			return apis.NewBadRequestError("invalid 'to' (RFC3339)", nil)
		}

		table, timeCol := pickTier(to.Sub(from))
		filter := "site = {:s} && controller = {:c} && sensor = {:n} && " +
			timeCol + " >= {:from} && " + timeCol + " <= {:to}"
		params := dbx.Params{
			"s": site, "c": ctrl, "n": sensor,
			"from": from.UTC().Format(time.RFC3339),
			"to":   to.UTC().Format(time.RFC3339),
		}
		recs, err := e.App.FindRecordsByFilter(table, filter, timeCol, 5000, 0, params)
		if err != nil {
			return apis.NewBadRequestError("query failed", err)
		}
		out := make([]map[string]any, 0, len(recs))
		for _, r := range recs {
			if table == "telemetry_raw" {
				out = append(out, map[string]any{"ts": r.GetString("ts"), "value": r.GetFloat("value")})
			} else {
				out = append(out, map[string]any{
					"ts":  r.GetString("window"),
					"avg": r.GetFloat("avg"), "min": r.GetFloat("min"), "max": r.GetFloat("max"),
				})
			}
		}
		return e.JSON(http.StatusOK, map[string]any{"tier": table, "samples": out})
	})

	// POST /command {site, controller, action, route_id?} — authorize, record
	// the command (audit), then publish it to the device over MQTT.
	g.POST("/command", func(e *core.RequestEvent) error {
		var body struct {
			Site       string `json:"site"`
			Controller string `json:"controller"`
			Action     string `json:"action"`
			RouteID    *int   `json:"route_id"`
		}
		if err := e.BindBody(&body); err != nil {
			return apis.NewBadRequestError("invalid body", err)
		}
		if err := requireSiteAccess(e, body.Site); err != nil {
			return err
		}
		if body.Controller == "" || !commandActions[body.Action] {
			return apis.NewBadRequestError("controller and a valid action are required", nil)
		}
		if routeActions[body.Action] && body.RouteID == nil {
			return apis.NewBadRequestError("route_id is required for "+body.Action, nil)
		}

		commandID := security.RandomString(15)

		coll, err := e.App.FindCollectionByNameOrId("commands")
		if err != nil {
			return apis.NewApiError(http.StatusInternalServerError, "commands collection missing", err)
		}
		rec := core.NewRecord(coll)
		rec.Set("site", body.Site)
		rec.Set("controller", body.Controller)
		rec.Set("command_id", commandID)
		rec.Set("action", body.Action)
		if body.RouteID != nil {
			rec.Set("route_id", *body.RouteID)
		}
		rec.Set("status", "sent")
		rec.Set("issued_by", e.Auth.Id)
		if err := e.App.Save(rec); err != nil {
			return apis.NewApiError(http.StatusInternalServerError, "failed to record command", err)
		}

		envelope := map[string]any{"command_id": commandID, "action": body.Action}
		if body.RouteID != nil {
			envelope["route_id"] = *body.RouteID
		}
		payload, _ := json.Marshal(envelope)
		if err := pub.Publish(telemetry.CommandTopic(body.Site, body.Controller), payload, false, 1); err != nil {
			rec.Set("status", "failed")
			_ = e.App.Save(rec)
			return apis.NewApiError(http.StatusBadGateway, "failed to publish command", err)
		}

		return e.JSON(http.StatusOK, map[string]any{"command_id": commandID})
	})
}

// pickTier maps a requested time span to the storage tier that serves it
// without flooding the client: short windows hit raw, longer ones the rollups.
func pickTier(span time.Duration) (table, timeCol string) {
	switch {
	case span <= 6*time.Hour:
		return "telemetry_raw", "ts"
	case span <= 7*24*time.Hour:
		return "telemetry_5min", "window"
	default:
		return "telemetry_1hr", "window"
	}
}

// requireSiteAccess enforces authentication and site ownership (admins bypass).
func requireSiteAccess(e *core.RequestEvent, siteID string) error {
	if e.Auth == nil {
		return apis.NewUnauthorizedError("authentication required", nil)
	}
	if siteID == "" {
		return apis.NewBadRequestError("site is required", nil)
	}
	if e.Auth.GetString("role") == "admin" {
		return nil
	}
	site, err := e.App.FindRecordById("sites", siteID)
	if err != nil {
		return apis.NewNotFoundError("site not found", nil)
	}
	if site.GetString("owner") != e.Auth.Id {
		return apis.NewForbiddenError("you do not own this site", nil)
	}
	return nil
}
