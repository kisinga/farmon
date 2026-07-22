// Package server wires the shared PocketBase application used by both the
// cloud and edge binaries.
package server

import (
	"errors"
	"io"
	"mime"
	"net/http"
	"os"
	"path"
	"time"

	"github.com/kisinga/majiflow/internal/alerts"
	"github.com/kisinga/majiflow/internal/api"
	"github.com/kisinga/majiflow/internal/automations"
	"github.com/kisinga/majiflow/internal/billing"
	"github.com/kisinga/majiflow/internal/config"
	"github.com/kisinga/majiflow/internal/metering"
	"github.com/kisinga/majiflow/internal/mqtt"
	"github.com/kisinga/majiflow/internal/telemetry"

	"github.com/pocketbase/pocketbase"
	"github.com/pocketbase/pocketbase/apis"
	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/plugins/migratecmd"
	"github.com/pocketbase/pocketbase/tools/router"
	"github.com/pocketbase/pocketbase/tools/subscriptions"

	// Side-effect import: registers the Go migrations that define collections.
	_ "github.com/kisinga/majiflow/migrations"
)

// realtimeKeepaliveInterval must stay well under the shortest idle timeout in the
// path. Cloudflare reaps a proxied SSE stream after ~100s of silence; a quiet
// dashboard then reconnects and re-syncs, which is the bulk of the idle CPU churn.
const realtimeKeepaliveInterval = 25 * time.Second

// New builds a configured PocketBase application for the given mode. The caller
// is responsible for invoking app.Start().
func New(cfg config.Config) *pocketbase.PocketBase {
	app := pocketbase.New()

	migratecmd.MustRegister(app, app.RootCmd, migratecmd.Config{
		Automigrate: true,
	})

	// Public lead form guard: drop obvious bot spam (honeypot tripped) and never
	// store an enquiry without explicit consent. Runs before the `leads` record
	// is persisted; the honeypot value itself is never kept.
	app.OnRecordCreateRequest("leads").BindFunc(func(e *core.RecordRequestEvent) error {
		if e.Record.GetString("hp") != "" {
			return apis.NewBadRequestError("Rejected.", nil)
		}
		if !e.Record.GetBool("consent") {
			return apis.NewBadRequestError("Consent is required.", nil)
		}
		e.Record.Set("hp", "")
		return e.Next()
	})

	// Device lifecycle: a controller is born when saved into a site's design.
	// Guards site ownership, the managed device cap, and reconciles controllers.
	registerSiteHooks(app, cfg)

	// User-account guards: partners can manage their own customers but cannot
	// escalate roles or reassign partners.
	registerUserHooks(app)

	// Automation write guards: controller-belongs-to-site + per-controller cap.
	automations.RegisterGuards(app)

	// Automation changes -> append-only config_events rows (the Activity timeline's
	// third source), attributed to the acting user. Independent of the republish hook.
	automations.RegisterActivity(app)

	app.OnServe().BindFunc(func(se *core.ServeEvent) error {
		seedAdmin(se.App)

		broker, err := mqtt.Start(se.App, cfg)
		if err != nil {
			return err
		}

		go telemetry.RunScheduler(se.App)
		go alerts.RunSweeper(se.App)
		go keepRealtimeAlive(se.App)

		// Shengda meter UDP ingestion (cloud only — an edge box has no meters
		// phoning home to it). Disabled when MAJI_METER_UDP_ADDR is unset.
		if cfg.Mode == config.ModeCloud && cfg.MeterUDPAddr != "" {
			if err := metering.StartListener(se.App, cfg); err != nil {
				return err
			}
		}

		// Tenant-billing jobs: cycles, invoice preparation, overdue marking,
		// and the arrears→valve sweep (cloud only).
		if cfg.Mode == config.ModeCloud {
			go billing.RunScheduler(se.App)
		}

		api.Register(se, cfg, broker.Server)
		api.RegisterBilling(se, cfg)

		// Republish a controller's retained automation set on any change to the
		// automations collection (DB is source of truth; device is a mirror).
		automations.Register(se.App, broker.Server)

		// Republish a controller's retained desired-config message (tunables +
		// calibration) on any change to the controller_config collection. The
		// dashboard writes the desired bag; the server recomputes the canonical
		// payload + sha256 version and re-pushes (the single config write path —
		// config_set is gone). Same dumb-pipe shape as the automations republish.
		automations.RegisterConfig(se.App, broker.Server)

		// Re-push the retained sets when a controller reports a new firmware version (a
		// reflash/OTA) or drifts from the desired config: the device boots with an empty
		// in-RAM automation table, and both sets are otherwise published only on a DB
		// change — so a reflash would lose them until an operator toggled something.
		// Wired here (not imported by the telemetry package) to avoid an import cycle:
		// the telemetry reconcile loop calls back through these vars. See reconcileConfig.
		telemetry.AutomationsRepublisher = func(app core.App, site, ctrl string) error {
			return automations.PublishForController(app, broker.Server, site, ctrl)
		}
		telemetry.ConfigRepublisher = func(app core.App, site, ctrl string) error {
			return automations.PublishConfigForController(app, broker.Server, site, ctrl)
		}

		// Host the device-mode app build (pre-gzipped assets + manifest) for the
		// browser-side firmware codegen, which fetches them at bundle-generation
		// time to embed into the firmware's local-ui asset table. Served as RAW
		// bytes: the .gz payloads are the exact bytes flashed to the device — the
		// browser reads them with fetch()/arrayBuffer, so Content-Encoding must
		// NOT be set (the transport must not gunzip them).
		if cfg.DeviceUIDir != "" {
			deviceFS := os.DirFS(cfg.DeviceUIDir)
			se.Router.GET("/device-ui/{path...}", func(e *core.RequestEvent) error {
				// path.Clean with a leading slash confines traversal ("../" stays
				// inside the root); the trimmed result is the fs-relative name.
				name := path.Clean("/" + e.Request.PathValue("path"))[1:]
				f, err := deviceFS.Open(name)
				if err != nil {
					return apis.NewNotFoundError("not found", nil)
				}
				defer f.Close()
				st, err := f.Stat()
				if err != nil || st.IsDir() {
					return apis.NewNotFoundError("not found", nil)
				}
				rs, ok := f.(io.ReadSeeker)
				if !ok {
					return apis.NewNotFoundError("not found", nil)
				}
				ctype := deviceUIContentType(name)
				e.Response.Header().Set("Content-Type", ctype)
				e.Response.Header().Del("Content-Encoding")
				// These files are fetched at firmware-generation time; a stale cached
				// .gz from a previous deploy silently mixes two app builds into one
				// bundle (index references assets that were never embedded). Force
				// revalidation on every generation.
				e.Response.Header().Set("Cache-Control", "no-cache")
				http.ServeContent(e.Response, e.Request, st.Name(), st.ModTime(), rs)
				return nil
			})
		}

		// Serve the built SPA when a directory is configured. Prerendered marketing
		// pages (/, /pricing, /features) resolve to their own index.html; every
		// other path is an authenticated SPA route, so it falls back to the bare
		// client shell (index.csr.html) instead of the prerendered landing page.
		// Falling back to the landing page would boot the app over landing markup
		// and trigger a hydration mismatch and the wrong document title.
		if cfg.SPADir != "" {
			spaFS := os.DirFS(cfg.SPADir)
			serveStatic := apis.Static(spaFS, false)
			se.Router.GET("/{path...}", func(e *core.RequestEvent) error {
				err := serveStatic(e)
				if err != nil && errors.Is(err, router.ErrFileNotFound) {
					return e.FileFS(spaFS, "index.csr.html")
				}
				return err
			})
		}

		return se.Next()
	})

	return app
}

// deviceUIContentType picks the Content-Type for a /device-ui/ asset. The .gz
// siblings are application/gzip payloads fetched as arrayBuffer; anything
// without a registered type falls back to octet-stream. Go's built-in table has
// no ".gz" entry and the alpine image ships no /etc/mime.types, so pin it here.
func deviceUIContentType(name string) string {
	if path.Ext(name) == ".gz" {
		return "application/gzip"
	}
	if ctype := mime.TypeByExtension(path.Ext(name)); ctype != "" {
		return ctype
	}
	return "application/octet-stream"
}

// keepRealtimeAlive pushes a no-op event through every connected realtime (SSE)
// client on an interval so the stream is never idle long enough for a proxy to
// reap it (see realtimeKeepaliveInterval). PocketBase writes to an SSE stream only
// when an event matches a subscription, so an idle dashboard sends zero bytes and
// Cloudflare cuts it; the client reconnects and re-syncs — pure churn. The event
// name matches no subscription, so the JS SDK ignores it client-side; the bytes
// alone keep the connection warm. Fire-and-forget like RunScheduler/RunSweeper:
// the goroutine lives for the process. Send() is a no-op on a discarded client.
func keepRealtimeAlive(app core.App) {
	ticker := time.NewTicker(realtimeKeepaliveInterval)
	defer ticker.Stop()
	msg := subscriptions.Message{Name: "PB_KEEPALIVE", Data: []byte("{}")}
	for range ticker.C {
		for _, client := range app.SubscriptionsBroker().Clients() {
			client.Send(msg)
		}
	}
}
