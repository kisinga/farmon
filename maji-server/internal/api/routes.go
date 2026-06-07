// Package api mounts the domain-agnostic /api/farmon route group.
package api

import (
	"encoding/json"
	"fmt"
	"net/http"
	"time"

	"github.com/kisinga/majiflow/internal/auth"
	"github.com/kisinga/majiflow/internal/config"
	"github.com/kisinga/majiflow/internal/telemetry"
	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/apis"
	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tools/security"
	"github.com/pocketbase/pocketbase/tools/types"
)

// hostingDeviceCap is the fallback device cap a managed site's yearly hosting fee
// covers, used when app_config is missing/unset. The live value is admin-tunable
// in app_config; mirrored by HOSTING_DEVICE_CAP in core. On-prem sites are uncapped.
const hostingDeviceCap = 5

// hostingCap returns the configured managed device cap, falling back to the
// built-in default when app_config has no usable value.
func hostingCap(app core.App) int {
	rec, err := app.FindFirstRecordByFilter("app_config", "id != ''")
	if err != nil || rec == nil {
		return hostingDeviceCap
	}
	if v := rec.GetInt("hosting_device_cap"); v > 0 {
		return v
	}
	return hostingDeviceCap
}

// Publisher is the subset of the MQTT broker the command endpoint needs.
// The Mochi *server.Server satisfies it (InlineClient must be enabled).
type Publisher interface {
	Publish(topic string, payload []byte, retain bool, qos byte) error
}

// commandActions mirrors CommandAction in src/lib/codegen-ids.ts.
var commandActions = map[string]bool{
	"route_start": true, "route_stop": true, "fault_reset": true,
	"stop_all": true, "reset_faults": true, "clear_queue": true,
	"node_set": true, "safety_override": true,
}

// routeActions are the commands that require a route_id.
var routeActions = map[string]bool{
	"route_start": true, "route_stop": true, "fault_reset": true,
}

// nodeActions require a node_id (which actuator); onActions require an on bool.
var nodeActions = map[string]bool{"node_set": true}
var onActions = map[string]bool{"node_set": true, "safety_override": true}

// Register mounts the /api/farmon routes on the serve event's router.
func Register(se *core.ServeEvent, cfg config.Config, pub Publisher) {
	g := se.Router.Group("/api/farmon")

	g.GET("/health", func(e *core.RequestEvent) error {
		return e.JSON(http.StatusOK, map[string]any{
			"status": "ok",
			"mode":   string(cfg.Mode),
		})
	})

	// GET /deployment — the cloud broker defaults used to AUTOFILL an Online site
	// (mqtt.majiflow.io:8883, TLS). The per-site mode (Online vs Local) and any
	// Local broker address are chosen on the site itself, not dictated here. A
	// fallback `mode` still follows the server build shape (cloud→managed,
	// edge→local) for sites that haven't picked one yet.
	g.GET("/deployment", func(e *core.RequestEvent) error {
		if e.Auth == nil {
			return apis.NewUnauthorizedError("authentication required", nil)
		}
		firmwareMode := "managed"
		if cfg.Mode == config.ModeEdge {
			firmwareMode = "local"
		}
		return e.JSON(http.StatusOK, map[string]any{
			"broker_address": cfg.MQTTPublicHost,
			"broker_port":    cfg.MQTTPublicPort,
			"broker_tls":     cfg.MQTTPublicTLS,
			"mode":           firmwareMode,
		})
	})

	// GET /config exposes admin-tunable global settings (app_config) to the UI, so
	// the frontend never reads the collection directly. Authed; public bits only.
	g.GET("/config", func(e *core.RequestEvent) error {
		if e.Auth == nil {
			return apis.NewUnauthorizedError("authentication required", nil)
		}
		return e.JSON(http.StatusOK, map[string]any{
			"hostingDeviceCap": hostingCap(e.App),
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
			NodeID     string `json:"node_id"`
			On         *bool  `json:"on"`
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
		if nodeActions[body.Action] && body.NodeID == "" {
			return apis.NewBadRequestError("node_id is required for "+body.Action, nil)
		}
		if onActions[body.Action] && body.On == nil {
			return apis.NewBadRequestError("on is required for "+body.Action, nil)
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
		// Command provenance: record the issuer's usertype so an admin acting on a
		// customer's site (after "Take control") is accountable in the same row.
		rec.Set("issued_role", e.Auth.GetString("role"))
		if err := e.App.Save(rec); err != nil {
			return apis.NewApiError(http.StatusInternalServerError, "failed to record command", err)
		}

		// issued_at stamps the command's age so the device can drop a stale one
		// (queued during an outage) instead of replaying it — see the firmware TTL gate.
		envelope := map[string]any{
			"command_id": commandID,
			"action":     body.Action,
			"issued_at":  time.Now().Unix(),
		}
		if body.RouteID != nil {
			envelope["route_id"] = *body.RouteID
		}
		if body.NodeID != "" {
			envelope["node_id"] = body.NodeID
		}
		if body.On != nil {
			envelope["on"] = *body.On
		}
		payload, _ := json.Marshal(envelope)
		if err := pub.Publish(telemetry.CommandTopic(body.Site, body.Controller), payload, false, 1); err != nil {
			rec.Set("status", "failed")
			_ = e.App.Save(rec)
			return apis.NewApiError(http.StatusBadGateway, "failed to publish command", err)
		}

		return e.JSON(http.StatusOK, map[string]any{"command_id": commandID})
	})

	// POST /provision {site, controller, name?, board_type?, rotate?} — (re)register
	// a controller in the controllers collection and return its MQTT token (raw),
	// OTA password and site UDP key so the firmware generator can bake them into
	// this build's secrets.yaml. The MQTT token is stable: minted once at first
	// provision and reused on later builds (rotate=true forces a new one); the
	// broker authenticates the device by username == controller (== device_id)
	// against the token's bcrypt hash, kept in lockstep with the raw value.
	g.POST("/provision", func(e *core.RequestEvent) error {
		var body struct {
			Site       string `json:"site"`
			Controller string `json:"controller"`
			Name       string `json:"name"`
			BoardType  string `json:"board_type"`
			// Rotate forces a fresh MQTT token even when one already exists (the
			// deliberate "I want new credentials" path). Default false: a normal
			// build reuses the stored token so a flashed device keeps connecting.
			Rotate bool `json:"rotate"`
		}
		if err := e.BindBody(&body); err != nil {
			return apis.NewBadRequestError("invalid body", err)
		}
		if err := requireSiteAccess(e, body.Site); err != nil {
			return err
		}
		if body.Controller == "" {
			return apis.NewBadRequestError("controller is required", nil)
		}

		// Site record: needed for the per-site UDP key, the managed-hosting device
		// cap, and the hosting-start clock below.
		siteRec, err := e.App.FindRecordById("sites", body.Site)
		if err != nil || siteRec == nil {
			return apis.NewApiError(http.StatusInternalServerError, "site not found", err)
		}

		// Hosting (device cap + commence clock) applies to managed sites only. A
		// site's explicit `mode` wins; an unset mode follows the server build shape
		// (cloud → managed, edge → local). On-prem (local) sites are uncapped.
		siteMode := siteRec.GetString("mode")
		if siteMode == "" {
			if cfg.Mode == config.ModeCloud {
				siteMode = "managed"
			} else {
				siteMode = "local"
			}
		}
		managed := siteMode == "managed"

		// Identity row, upserted by device_id (globally unique). A missing row
		// (or any lookup miss) means first provision → create; otherwise we keep
		// the row and rotate/refresh its secrets below.
		rec, err := e.App.FindFirstRecordByFilter(
			"controllers", "device_id = {:d}", dbx.Params{"d": body.Controller},
		)
		if err != nil || rec == nil {
			// A new device on a managed site counts against the hosting plan's
			// device cap; re-provisioning an existing device only rotates its token
			// and is never capped.
			if managed {
				cap := hostingCap(e.App)
				count, cerr := e.App.CountRecords("controllers", dbx.HashExp{"site": body.Site})
				if cerr != nil {
					return apis.NewApiError(http.StatusInternalServerError, "failed to count devices", cerr)
				}
				if count >= int64(cap) {
					return apis.NewBadRequestError(
						fmt.Sprintf("hosting plan covers up to %d devices per site; remove a device or move to on-prem to add more", cap),
						nil,
					)
				}
			}
			coll, cerr := e.App.FindCollectionByNameOrId("controllers")
			if cerr != nil {
				return apis.NewApiError(http.StatusInternalServerError, "controllers collection missing", cerr)
			}
			rec = core.NewRecord(coll)
			rec.Set("device_id", body.Controller)
		}

		// MQTT token: stable across rebuilds. The broker authenticates a device by
		// the password it was flashed with, so re-minting on every build would lock
		// out an already-flashed device. Like the OTA password, we generate it once
		// at first provision, store it raw (+ its bcrypt hash for the broker), and
		// reuse it on later builds; an explicit `rotate` mints a new one.
		token := rec.GetString("mqtt_token")
		if token == "" || body.Rotate {
			token, err = auth.GenerateToken()
			if err != nil {
				return apis.NewApiError(http.StatusInternalServerError, "failed to mint token", err)
			}
			hash, herr := auth.HashToken(token)
			if herr != nil {
				return apis.NewApiError(http.StatusInternalServerError, "failed to hash token", herr)
			}
			rec.Set("mqtt_token", token)
			rec.Set("token_hash", hash)
		}

		// OTA password: generated once and reused. It must stay stable across
		// rebuilds (ESPHome OTA authenticates the new build against the password
		// the running device holds), so the firmware bakes the literal value —
		// we store it raw and only mint it when the row doesn't have one yet.
		otaPassword := rec.GetString("ota_password")
		if otaPassword == "" {
			otaPassword, err = auth.GenerateToken()
			if err != nil {
				return apis.NewApiError(http.StatusInternalServerError, "failed to mint OTA password", err)
			}
		}

		rec.Set("site", body.Site)
		if body.Name != "" {
			rec.Set("name", body.Name)
		}
		if body.BoardType != "" {
			rec.Set("board_type", body.BoardType)
		}
		rec.Set("ota_password", otaPassword)
		if err := e.App.Save(rec); err != nil {
			return apis.NewApiError(http.StatusInternalServerError, "failed to register controller", err)
		}

		// Per-site UDP coordination key (shared by every controller on the site,
		// authenticates cross-controller claims/readings over the LAN UDP lane) and
		// the managed hosting clock both live on the site record; mint/stamp what's
		// missing and save once.
		siteDirty := false
		udpKey := siteRec.GetString("udp_key")
		if udpKey == "" {
			udpKey, err = auth.GenerateToken()
			if err != nil {
				return apis.NewApiError(http.StatusInternalServerError, "failed to mint UDP key", err)
			}
			siteRec.Set("udp_key", udpKey)
			siteDirty = true
		}
		// Hosting starts at the first managed provision; stamp once, never reset.
		if managed && siteRec.GetDateTime("commence_date").IsZero() {
			siteRec.Set("commence_date", types.NowDateTime())
			siteDirty = true
		}
		if siteDirty {
			if err := e.App.Save(siteRec); err != nil {
				return apis.NewApiError(http.StatusInternalServerError, "failed to update site", err)
			}
		}

		return e.JSON(http.StatusOK, map[string]any{"token": token, "ota_password": otaPassword, "udp_key": udpKey})
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
