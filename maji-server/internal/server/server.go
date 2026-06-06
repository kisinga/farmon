// Package server wires the shared PocketBase application used by both the
// cloud and edge binaries.
package server

import (
	"os"

	"github.com/kisinga/majiflow/internal/api"
	"github.com/kisinga/majiflow/internal/config"
	"github.com/kisinga/majiflow/internal/mqtt"
	"github.com/kisinga/majiflow/internal/telemetry"

	"github.com/pocketbase/pocketbase"
	"github.com/pocketbase/pocketbase/apis"
	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/plugins/migratecmd"

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

	app.OnServe().BindFunc(func(se *core.ServeEvent) error {
		seedAdmin(se.App)

		broker, err := mqtt.Start(se.App, cfg)
		if err != nil {
			return err
		}

		go telemetry.RunScheduler(se.App)

		api.Register(se, cfg, broker.Server)

		// Serve the built SPA (index fallback for client-side routing) when a
		// directory is configured.
		if cfg.SPADir != "" {
			se.Router.GET("/{path...}", apis.Static(os.DirFS(cfg.SPADir), true))
		}

		return se.Next()
	})

	return app
}
