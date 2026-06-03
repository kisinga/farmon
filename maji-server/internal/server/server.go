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

	app.OnServe().BindFunc(func(se *core.ServeEvent) error {
		seedAdmin(se.App)

		if _, err := mqtt.Start(se.App, cfg); err != nil {
			return err
		}

		go telemetry.RunScheduler(se.App)

		api.Register(se, cfg)

		// Serve the built SPA (index fallback for client-side routing) when a
		// directory is configured.
		if cfg.SPADir != "" {
			se.Router.GET("/{path...}", apis.Static(os.DirFS(cfg.SPADir), true))
		}

		return se.Next()
	})

	return app
}
