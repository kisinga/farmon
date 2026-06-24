// Package api mounts the domain-agnostic /api/farmon route group.
package api

import (
	"crypto/md5"
	"crypto/subtle"
	"encoding/hex"
	"encoding/pem"
	"fmt"
	"io"
	"net/http"
	"os"
	"slices"
	"strconv"
	"strings"
	"time"

	"github.com/kisinga/majiflow/internal/auth"
	"github.com/kisinga/majiflow/internal/command"
	"github.com/kisinga/majiflow/internal/config"
	"github.com/kisinga/majiflow/internal/telemetry"
	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/apis"
	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tools/filesystem"
	"github.com/pocketbase/pocketbase/tools/security"
)

// hostingDeviceCap is the fallback device cap a managed site's yearly hosting fee
// covers, used when app_config is missing/unset. The live value is admin-tunable
// in app_config; mirrored by HOSTING_DEVICE_CAP in core. On-prem sites are uncapped.
const hostingDeviceCap = 5

// HostingCap returns the configured managed device cap, falling back to the
// built-in default when app_config has no usable value.
func HostingCap(app core.App) int {
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

// otaDownloadTTL bounds how long a deploy's firmware download token stays valid.
// It must outlast the gap between publishing the (QoS 1, queued) firmware_update
// command and an offline device reconnecting to consume it and fetch the image.
const otaDownloadTTL = 24 * time.Hour

// readCABlock returns the PEM of the last CERTIFICATE block in the file at path.
// fullchain.pem holds a single self-signed broker cert, so this returns that cert; the
// firmware pins it byte-for-byte as its certificate_authority. esp-idf mbedTLS trusts a
// self-signed cert it finds identical in its store but rejects a two-tier CA chain, so
// the pinned cert IS the served cert. Returns "" when the path is empty or unreadable.
// (Taking the LAST block keeps it correct even if a leaf+CA chain is ever mounted.)
func readCABlock(path string) string {
	if path == "" {
		return ""
	}
	data, err := os.ReadFile(path)
	if err != nil {
		return ""
	}
	var last *pem.Block
	for {
		var blk *pem.Block
		if blk, data = pem.Decode(data); blk == nil {
			break
		}
		if blk.Type == "CERTIFICATE" {
			last = blk
		}
	}
	if last == nil {
		return ""
	}
	return string(pem.EncodeToMemory(last))
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
			// The CA the firmware pins as its certificate_authority — the issuer at
			// the end of the served leaf+CA chain, so leaf rotation needs no re-flash.
			"broker_ca": readCABlock(cfg.MQTTTLSCert),
			"mode":      firmwareMode,
		})
	})

	// GET /config exposes admin-tunable global settings (app_config) to the UI, so
	// the frontend never reads the collection directly. Authed; public bits only.
	g.GET("/config", func(e *core.RequestEvent) error {
		if e.Auth == nil {
			return apis.NewUnauthorizedError("authentication required", nil)
		}
		return e.JSON(http.StatusOK, map[string]any{
			"hostingDeviceCap": HostingCap(e.App),
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
		// One latest-snapshot doc per controller; the browser explodes it into its
		// per-channel view (the same shape the realtime controller_state stream gives).
		recs, err := e.App.FindRecordsByFilter("controller_state", filter, "controller", 500, 0, params)
		if err != nil {
			return apis.NewBadRequestError("query failed", err)
		}
		out := make([]map[string]any, 0, len(recs))
		for _, r := range recs {
			out = append(out, map[string]any{
				"controller": r.GetString("controller"),
				"snapshot":   r.GetString("snapshot"),
				"ts":         r.GetString("ts"),
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

	// GET /usage?site=&controller=&route=&from=&to= — the billing-grade usage facade.
	// Reads the immutable runs ledger (NOT the lossy client-side rate integration):
	// per-run line items on both axes (duration always; delivered litres when metered),
	// period totals, and a per-route continuity flag. Water only flows while a run is
	// open, so consecutive metered runs on a route must be continuous (one run's end
	// counter == the next run's start counter); a break means a run was missed or water
	// moved while idle — surfaced here rather than silently mis-billed.
	g.GET("/usage", func(e *core.RequestEvent) error {
		q := e.Request.URL.Query()
		site := q.Get("site")
		if err := requireSiteAccess(e, site); err != nil {
			return err
		}
		from, err := time.Parse(time.RFC3339, q.Get("from"))
		if err != nil {
			return apis.NewBadRequestError("invalid 'from' (RFC3339)", nil)
		}
		to, err := time.Parse(time.RFC3339, q.Get("to"))
		if err != nil {
			return apis.NewBadRequestError("invalid 'to' (RFC3339)", nil)
		}
		// Bound on started_at (when the water actually flowed), ordered the same so the
		// continuity pass sees runs in chronological (≈ seq) order.
		filter := "site = {:s} && started_at >= {:from} && started_at <= {:to}"
		params := dbx.Params{
			"s":    site,
			"from": from.UTC().Format(time.RFC3339),
			"to":   to.UTC().Format(time.RFC3339),
		}
		if ctrl := q.Get("controller"); ctrl != "" {
			filter += " && controller = {:c}"
			params["c"] = ctrl
		}
		if rt := q.Get("route"); rt != "" {
			n, convErr := strconv.Atoi(rt)
			if convErr != nil {
				return apis.NewBadRequestError("invalid 'route'", nil)
			}
			filter += " && route = {:rt}"
			params["rt"] = n
		}
		// Paginate so a high-volume period isn't silently capped (billing must not
		// under-report). maxRuns bounds memory; truncated surfaces the cut to the client.
		const pageSize = 5000
		const maxRuns = 100000
		recs := make([]*core.Record, 0)
		truncated := false
		for offset := 0; ; offset += pageSize {
			page, err := e.App.FindRecordsByFilter("runs", filter, "started_at", pageSize, offset, params)
			if err != nil {
				return apis.NewBadRequestError("query failed", err)
			}
			recs = append(recs, page...)
			if len(page) < pageSize {
				break
			}
			if len(recs) >= maxRuns {
				truncated = true
				break
			}
		}

		// Per-route continuity tracker: within one device epoch, this run's start
		// counter must equal the previous run's end counter. An epoch change (reflash /
		// board swap) resets the lineage, so it never counts as a gap.
		type contKey struct {
			ctrl  string
			route int
		}
		type contState struct {
			lastEnd   float64
			lastEpoch int64
			haveLast  bool
			ok        bool
			gapLitres float64
		}
		cont := map[contKey]*contState{}

		runs := make([]map[string]any, 0, len(recs))
		var totalLitres float64
		var totalDurationS int64
		for _, r := range recs {
			metered := r.GetBool("metered")
			startL := r.GetFloat("start_litres")
			endL := r.GetFloat("end_litres")
			epoch := int64(r.GetInt("epoch"))
			route := r.GetInt("route")
			// This per-run shape is the UsageRun contract; the dashboard's live feed
			// builds the SAME shape directly from the runs collection (toRun in
			// src/app/core/services/realtime.service.ts). Keep the two in sync.
			item := map[string]any{
				"run_id":      r.GetString("run_id"),
				"controller":  r.GetString("controller"),
				"route":       route,
				"started_at":  r.GetString("started_at"),
				"ended_at":    r.GetString("ended_at"),
				"duration_s":  r.GetInt("duration_s"),
				"stop_reason": r.GetString("stop_reason"),
				"origin":      r.GetString("origin"),
				"actor_label": r.GetString("actor_label"),
				"fault":       r.GetString("fault"),
				"metered":     metered,
			}
			totalDurationS += int64(r.GetInt("duration_s"))
			if metered {
				delivered := endL - startL
				item["delivered_l"] = delivered
				totalLitres += delivered

				k := contKey{r.GetString("controller"), route}
				st := cont[k]
				if st == nil {
					st = &contState{ok: true}
					// Seed from the metered run immediately before the window, so a gap
					// straddling the window start is caught (not just gaps between two
					// in-window runs).
					prior, _ := e.App.FindRecordsByFilter("runs",
						"controller = {:pc} && route = {:pr} && metered = true && started_at < {:pf}",
						"-started_at", 1, 0,
						dbx.Params{"pc": k.ctrl, "pr": route, "pf": params["from"]})
					if len(prior) == 1 {
						st.lastEnd = prior[0].GetFloat("end_litres")
						st.lastEpoch = int64(prior[0].GetInt("epoch"))
						st.haveLast = true
					}
					cont[k] = st
				}
				if st.haveLast && epoch == st.lastEpoch && startL != st.lastEnd {
					st.ok = false
					st.gapLitres += startL - st.lastEnd
				}
				st.lastEnd = endL
				st.lastEpoch = epoch
				st.haveLast = true
			} else {
				item["delivered_l"] = nil // unmetered: time-billable only
			}
			runs = append(runs, item)
		}

		continuity := make([]map[string]any, 0, len(cont))
		for k, st := range cont {
			continuity = append(continuity, map[string]any{
				"controller": k.ctrl,
				"route":      k.route,
				"ok":         st.ok,
				"gap_litres": st.gapLitres,
			})
		}

		return e.JSON(http.StatusOK, map[string]any{
			"runs": runs,
			"totals": map[string]any{
				"count":      len(runs),
				"litres":     totalLitres,
				"duration_s": totalDurationS,
			},
			"continuity": continuity,
			"truncated":  truncated,
		})
	})

	// POST /command {site, controller, action, route_id?} — authorize, record
	// the command (audit), then publish it to the device over MQTT.
	g.POST("/command", func(e *core.RequestEvent) error {
		var body struct {
			Site       string   `json:"site"`
			Controller string   `json:"controller"`
			Action     string   `json:"action"`
			RouteID    *int     `json:"route_id"`
			NodeID     string   `json:"node_id"`
			On         *bool    `json:"on"`
			Key        string   `json:"key"`
			Value      *float64 `json:"value"`
			OverrideMask      *int `json:"override_mask"`
			OvSourceMinPct    *int `json:"ov_source_min_pct"`
			OvDestMaxPct      *int `json:"ov_dest_max_pct"`
			OvMaxRuntimeMin   *int `json:"ov_max_runtime_min"`
			OvTargetDurationS *int `json:"ov_target_duration_s"`
			OvTargetVolumeL   *int `json:"ov_target_volume_l"`
			CommandID  string   `json:"command_id"`
			Reclaim    bool     `json:"reclaim"`
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
		// Action + per-action args are validated by the command contract (one source
		// of truth, mirrored to CommandEnvelope in src/lib/codegen-ids.ts). cmd is
		// reused below to build the wire envelope, so request → validate → publish
		// never re-describes the shape.
		cmd := command.Command{
			Action:  command.Action(body.Action),
			RouteID: body.RouteID,
			NodeID:  body.NodeID,
			On:      body.On,
			Key:     body.Key,
			Value:   body.Value,
			// route_start StopSpec override (forwarded verbatim; absent ⇒ route defaults).
			OverrideMask:      body.OverrideMask,
			OvSourceMinPct:    body.OvSourceMinPct,
			OvDestMaxPct:      body.OvDestMaxPct,
			OvMaxRuntimeMin:   body.OvMaxRuntimeMin,
			OvTargetDurationS: body.OvTargetDurationS,
			OvTargetVolumeL:   body.OvTargetVolumeL,
		}
		if err := cmd.ValidateOperator(); err != nil {
			return apis.NewBadRequestError(err.Error(), nil)
		}

		// Reclaim: a publish-only keepalive that re-asserts an existing hold's
		// command_id to refresh the device's dead-man lease. We republish with a
		// fresh issued_at (so it clears the firmware staleness gate) but write no
		// new audit row — the original command stays the single ledger entry, and
		// the device's outcome reconciles it by the reused command_id. Keeps the
		// re-assert path O(1) with zero DB writes, which is what lets it scale.
		if body.Reclaim {
			if body.CommandID == "" {
				return apis.NewBadRequestError("command_id is required for a reclaim", nil)
			}
			// Reclaim is the node_set hold keepalive — carry only the node fields,
			// never route_id/key/value even if the body happened to include them.
			reclaim := command.Command{
				CommandID: body.CommandID,
				Action:    cmd.Action,
				IssuedAt:  time.Now().Unix(),
				Actor:     e.Auth.Id,
				NodeID:    body.NodeID,
				On:        body.On,
			}
			if err := pub.Publish(telemetry.CommandTopic(body.Site, body.Controller), reclaim.Encode(), false, 1); err != nil {
				return apis.NewApiError(http.StatusBadGateway, "failed to publish reclaim", err)
			}
			return e.JSON(http.StatusOK, map[string]any{"command_id": body.CommandID})
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
		if body.NodeID != "" {
			rec.Set("node_id", body.NodeID)
		}
		if body.On != nil {
			rec.Set("node_on", *body.On)
		}
		if body.Key != "" {
			rec.Set("config_key", body.Key)
		}
		if body.Value != nil {
			rec.Set("config_value", *body.Value)
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
		// actor (the issuing user id) is stored on the run's slot and re-published as
		// the route's origin so the dashboard shows "by <name>".
		cmd.CommandID = commandID
		cmd.IssuedAt = time.Now().Unix()
		cmd.Actor = e.Auth.Id
		if err := pub.Publish(telemetry.CommandTopic(body.Site, body.Controller), cmd.Encode(), false, 1); err != nil {
			rec.Set("status", "failed")
			_ = e.App.Save(rec)
			return apis.NewApiError(http.StatusBadGateway, "failed to publish command", err)
		}

		return e.JSON(http.StatusOK, map[string]any{"command_id": commandID})
	})

	// POST /provision {site, controller, name?, board_type?, rotate?} — register the
	// controller (first call) and return its stable secrets (MQTT token (raw), OTA
	// password, site UDP key) for this build's secrets.yaml. Registration lives HERE,
	// at firmware Generate — the deliberate "make this controller a real device"
	// step — NOT on the autosaved draft topology (a working copy that must never
	// register devices or consume the cap). First provision creates the row and
	// counts against the managed hosting cap; rebuilds reuse it. The MQTT token is
	// minted once and reused (rotate=true forces a new one); the broker authenticates
	// username == controller (== device_id == id) against the token's bcrypt hash.
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

		siteRec, err := e.App.FindRecordById("sites", body.Site)
		if err != nil || siteRec == nil {
			return apis.NewApiError(http.StatusInternalServerError, "site not found", err)
		}
		// Cap + registration apply to managed sites. An explicit mode wins; an unset
		// mode follows the server build shape (cloud → managed). On-prem is uncapped.
		managed := siteRec.GetString("mode") == "managed" ||
			(siteRec.GetString("mode") == "" && cfg.Mode == config.ModeCloud)

		// Find-or-create. A missing row means first provision → register: a new device
		// on a managed site counts against the hosting cap (active rows only — a
		// deregistered slot is free). Re-provisioning an existing device only refreshes
		// its secrets and is never capped.
		rec, err := e.App.FindRecordById("controllers", body.Controller)
		if err != nil || rec == nil {
			if managed {
				cap := HostingCap(e.App)
				count, cerr := e.App.CountRecords("controllers", dbx.HashExp{"site": body.Site, "active": true})
				if cerr != nil {
					return apis.NewApiError(http.StatusInternalServerError, "failed to count devices", cerr)
				}
				if int(count) >= cap {
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
			rec.Id = body.Controller // device_id is the primary key
			rec.Set("active", true)
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

		// OTA password: minted once and reused. ESPHome OTA authenticates the new
		// build against the password the running device holds, so the firmware bakes
		// the literal value — store it raw, mint only when the row has none yet.
		otaPassword := rec.GetString("ota_password")
		if otaPassword == "" {
			otaPassword, err = auth.GenerateToken()
			if err != nil {
				return apis.NewApiError(http.StatusInternalServerError, "failed to mint OTA password", err)
			}
			rec.Set("ota_password", otaPassword)
		}

		rec.Set("site", body.Site)
		if body.Name != "" {
			rec.Set("name", body.Name)
		}
		if body.BoardType != "" {
			rec.Set("board_type", body.BoardType)
		}
		if err := e.App.Save(rec); err != nil {
			return apis.NewApiError(http.StatusInternalServerError, "failed to register controller", err)
		}

		// Per-site UDP coordination key (shared by every controller on the site,
		// authenticates cross-controller claims/readings over the LAN UDP lane); mint
		// once and reuse. The hosting clock starts at the controller's first live
		// connect (see telemetry.setControllerOnline), not here.
		udpKey := siteRec.GetString("udp_key")
		if udpKey == "" {
			udpKey, err = auth.GenerateToken()
			if err != nil {
				return apis.NewApiError(http.StatusInternalServerError, "failed to mint UDP key", err)
			}
			siteRec.Set("udp_key", udpKey)
			if err := e.App.Save(siteRec); err != nil {
				return apis.NewApiError(http.StatusInternalServerError, "failed to update site", err)
			}
		}

		return e.JSON(http.StatusOK, map[string]any{"token": token, "ota_password": otaPassword, "udp_key": udpKey})
	})

	// POST /firmware (multipart: site, controller, version, firmware_bin) — an admin
	// uploads a compiled binary for one controller. Gated by the admin's session
	// (requireSiteAccess), NEVER the device secret: that secret is baked into firmware
	// and extractable from any device/bundle, so it must not authorize pushing code.
	// The md5 is computed HERE (an uploader-supplied checksum is meaningless) and the
	// device later verifies the image against it. Uploading never reflashes — Deploy does.
	// Older binaries for the controller are pruned (history rows kept, bins dropped) so
	// storage stays latest-only.
	g.POST("/firmware", func(e *core.RequestEvent) error {
		site := e.Request.FormValue("site")
		controller := e.Request.FormValue("controller")
		version := e.Request.FormValue("version")
		if err := requireSiteAccess(e, site); err != nil {
			return err
		}
		if controller == "" {
			return apis.NewBadRequestError("controller is required", nil)
		}
		// Version is required: it's the device-side idempotency key (the firmware_update
		// no-op compares it to the running build) and the signal that confirms a release.
		// A blank version would reflash on every deploy and never confirm.
		if version == "" {
			return apis.NewBadRequestError("version is required", nil)
		}
		_, fh, err := e.Request.FormFile("firmware_bin")
		if err != nil {
			return apis.NewBadRequestError("firmware_bin file is required", err)
		}
		// md5 + size from a fresh read of the upload (authoritative, server-computed).
		src, err := fh.Open()
		if err != nil {
			return apis.NewBadRequestError("cannot read upload", err)
		}
		h := md5.New()
		size, err := io.Copy(h, src)
		_ = src.Close()
		if err != nil {
			return apis.NewApiError(http.StatusInternalServerError, "failed to hash upload", err)
		}
		if size == 0 {
			return apis.NewBadRequestError("firmware_bin is empty", nil)
		}
		md5hex := hex.EncodeToString(h.Sum(nil))

		file, err := filesystem.NewFileFromMultipart(fh)
		if err != nil {
			return apis.NewApiError(http.StatusInternalServerError, "failed to read upload", err)
		}
		coll, err := e.App.FindCollectionByNameOrId("firmware_releases")
		if err != nil {
			return apis.NewApiError(http.StatusInternalServerError, "firmware_releases collection missing", err)
		}
		rec := core.NewRecord(coll)
		rec.Set("site", site)
		rec.Set("controller", controller)
		rec.Set("version", version)
		rec.Set("md5", md5hex)
		rec.Set("size", size)
		rec.Set("uploaded_by", e.Auth.Id)
		rec.Set("status", "uploaded")
		rec.Set("firmware_bin", file)
		if err := e.App.Save(rec); err != nil {
			return apis.NewApiError(http.StatusInternalServerError, "failed to store firmware", err)
		}

		// Prune: keep the release history rows, but drop every other binary for this
		// controller so only the latest image occupies storage.
		older, _ := e.App.FindRecordsByFilter("firmware_releases",
			"controller = {:c} && id != {:id}", "-created", 0, 0,
			dbx.Params{"c": controller, "id": rec.Id})
		for _, o := range older {
			if o.GetString("firmware_bin") != "" {
				o.Set("firmware_bin", "")
				_ = e.App.Save(o)
			}
		}

		return e.JSON(http.StatusOK, map[string]any{
			"id": rec.Id, "md5": md5hex, "version": version, "size": size,
		})
	})

	// POST /firmware/deploy {site, controller, release_id} — tell the device to pull
	// and flash a previously-uploaded release. Mints a single-purpose, expiring download
	// token (the device has no session), records the imperative in the shared `commands`
	// audit, and publishes a firmware_update command on the device's command topic. The
	// md5 rides the cert-pinned, replay-protected command lane, so the download channel
	// itself need not be trusted — a swapped binary fails the md5 the device received here.
	g.POST("/firmware/deploy", func(e *core.RequestEvent) error {
		var body struct {
			Site       string `json:"site"`
			Controller string `json:"controller"`
			ReleaseID  string `json:"release_id"`
		}
		if err := e.BindBody(&body); err != nil {
			return apis.NewBadRequestError("invalid body", err)
		}
		if err := requireSiteAccess(e, body.Site); err != nil {
			return err
		}
		rec, err := e.App.FindRecordById("firmware_releases", body.ReleaseID)
		if err != nil || rec == nil {
			return apis.NewNotFoundError("release not found", nil)
		}
		if rec.GetString("site") != body.Site || rec.GetString("controller") != body.Controller {
			return apis.NewBadRequestError("release does not match site/controller", nil)
		}
		if rec.GetString("firmware_bin") == "" {
			return apis.NewBadRequestError("release binary no longer available; re-upload", nil)
		}

		token, err := auth.GenerateToken()
		if err != nil {
			return apis.NewApiError(http.StatusInternalServerError, "failed to mint download token", err)
		}
		rec.Set("download_token", token)
		// Outlive an offline device: the firmware_update command is queued (QoS 1,
		// persistent session) and may not deliver until the device reconnects, so the
		// download token has to still be valid then — not just for an online device.
		rec.Set("download_expires", time.Now().Add(otaDownloadTTL).UTC())
		rec.Set("status", "deployed")
		rec.Set("deployed_at", time.Now().UTC())
		if err := e.App.Save(rec); err != nil {
			return apis.NewApiError(http.StatusInternalServerError, "failed to mark deployed", err)
		}

		commandID := security.RandomString(15)
		if coll, cerr := e.App.FindCollectionByNameOrId("commands"); cerr == nil {
			audit := core.NewRecord(coll)
			audit.Set("site", body.Site)
			audit.Set("controller", body.Controller)
			audit.Set("command_id", commandID)
			audit.Set("action", "firmware_update")
			audit.Set("status", "sent")
			audit.Set("issued_by", e.Auth.Id)
			audit.Set("issued_role", e.Auth.GetString("role"))
			_ = e.App.Save(audit)
		}

		url := firmwareBaseURL(cfg, e) + "/api/farmon/firmware/" + rec.Id + "?t=" + token
		payload := command.Command{
			CommandID: commandID,
			Action:    command.FirmwareUpdate,
			IssuedAt:  time.Now().Unix(),
			Actor:     e.Auth.Id,
			Version:   rec.GetString("version"),
			URL:       url,
			MD5:       rec.GetString("md5"),
		}.Encode()
		if err := pub.Publish(telemetry.CommandTopic(body.Site, body.Controller), payload, false, 1); err != nil {
			// The command never went out — don't leave the release reading "deployed".
			// Mark it failed so the UI reflects reality and the admin re-deploys.
			rec.Set("status", "failed")
			_ = e.App.Save(rec)
			return apis.NewApiError(http.StatusBadGateway, "failed to publish command", err)
		}
		return e.JSON(http.StatusOK, map[string]any{"command_id": commandID, "status": "deployed"})
	})

	// GET /firmware/{id}?t=<token> — the device's download endpoint. No session: the
	// device proves nothing but a single-purpose, expiring capability token minted at
	// deploy time. Constant-time compare; expiry enforced. Kept inside /api/farmon so
	// the device fetches from the same host it already trusts.
	g.GET("/firmware/{id}", func(e *core.RequestEvent) error {
		rec, err := e.App.FindRecordById("firmware_releases", e.Request.PathValue("id"))
		if err != nil || rec == nil {
			return apis.NewNotFoundError("not found", nil)
		}
		want := rec.GetString("download_token")
		got := e.Request.URL.Query().Get("t")
		if want == "" || subtle.ConstantTimeCompare([]byte(want), []byte(got)) != 1 {
			return apis.NewForbiddenError("invalid token", nil)
		}
		if exp := rec.GetDateTime("download_expires"); exp.IsZero() || exp.Time().Before(time.Now()) {
			return apis.NewForbiddenError("token expired", nil)
		}
		name := rec.GetString("firmware_bin")
		if name == "" {
			return apis.NewNotFoundError("binary unavailable", nil)
		}
		fsys, err := e.App.NewFilesystem()
		if err != nil {
			return apis.NewApiError(http.StatusInternalServerError, "storage unavailable", err)
		}
		defer fsys.Close()
		return fsys.Serve(e.Response, e.Request, rec.BaseFilesPath()+"/"+name, name)
	})
}

// firmwareBaseURL is the origin the DEVICE pulls firmware from — forced to plain HTTP.
// The image is md5-verified (the md5 rides the cert-pinned MQTT command lane, the
// integrity anchor), so the download channel itself needs no TLS. And the device's
// esp32 mbedTLS can't reliably buffer a CDN's 16 KB TLS records on its tight heap, which
// made OTA-over-HTTPS flaky — so we hand the device an http:// URL and skip TLS entirely.
// Host comes from cfg.HTTPPublicURL when set (behind a proxy / a different device-facing
// host), else the admin's request host; the scheme is always http. NOTE: the CDN/edge in
// front of this host must NOT force-redirect this path to https (see the firmware GET
// route) or the device follows the 301 back into the TLS path it can't handle.
func firmwareBaseURL(cfg config.Config, e *core.RequestEvent) string {
	host := e.Request.Host
	if cfg.HTTPPublicURL != "" {
		host = strings.TrimRight(cfg.HTTPPublicURL, "/")
	}
	if i := strings.Index(host, "://"); i >= 0 {
		host = host[i+3:] // strip any scheme so we can force http
	}
	return "http://" + host
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

// IsAdmin reports whether the caller has full-platform privileges. A PocketBase
// superuser counts as admin: it sits above app roles and already bypasses
// collection rules, so request hooks must treat it the same (the check is on the
// authenticated collection and server-set role field, neither client-spoofable).
// Canonical privilege check — use this instead of testing role == "admin" directly.
func IsAdmin(auth *core.Record) bool {
	return auth != nil && (auth.IsSuperuser() || auth.GetString("role") == "admin")
}

// requireSiteAccess enforces authentication and site ownership (admins bypass).
func requireSiteAccess(e *core.RequestEvent, siteID string) error {
	if e.Auth == nil {
		return apis.NewUnauthorizedError("authentication required", nil)
	}
	if siteID == "" {
		return apis.NewBadRequestError("site is required", nil)
	}
	if IsAdmin(e.Auth) {
		return nil
	}
	site, err := e.App.FindRecordById("sites", siteID)
	if err != nil {
		return apis.NewNotFoundError("site not found", nil)
	}
	// owner is a set of co-owners (multi-relation); access is granted to any of them.
	if !slices.Contains(site.GetStringSlice("owner"), e.Auth.Id) {
		return apis.NewForbiddenError("you do not own this site", nil)
	}
	return nil
}
