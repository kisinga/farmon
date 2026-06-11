// Package server wires the shared PocketBase application used by both the
// cloud and edge binaries.
package server

import (
	"errors"
	"os"

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

	// Side-effect import: registers the Go migrations that define collections.
	_ "github.com/kisinga/majiflow/migrations"
)

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

	// Automation write guards: controller-belongs-to-site + per-controller cap.
	automations.RegisterGuards(app)

	app.OnServe().BindFunc(func(se *core.ServeEvent) error {
		seedAdmin(se.App)

		broker, err := mqtt.Start(se.App, cfg)
		if err != nil {
			return err
		}

		go telemetry.RunScheduler(se.App)
		go alerts.RunSweeper(se.App)

		api.Register(se, cfg, broker.Server)

		// Republish a controller's retained automation set on any change to the
		// automations collection (DB is source of truth; device is a mirror).
		automations.Register(se.App, broker.Server)

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
