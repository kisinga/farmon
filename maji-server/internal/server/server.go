// Package server wires the shared PocketBase application used by both the
// cloud and edge binaries.
package server

import (
	"errors"
	"os"
	"time"

	"github.com/kisinga/majiflow/internal/alerts"
	"github.com/kisinga/majiflow/internal/api"
	"github.com/kisinga/majiflow/internal/automations"
	"github.com/kisinga/majiflow/internal/config"
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

		api.Register(se, cfg, broker.Server)

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
