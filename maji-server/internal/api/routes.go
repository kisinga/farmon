// Package api mounts the domain-agnostic /api/farmon route group.
package api

import (
	"net/http"

	"github.com/kisinga/majiflow/internal/config"
	"github.com/pocketbase/pocketbase/core"
)

// Register mounts the /api/farmon routes on the serve event's router.
//
// This is a thin substrate. The commit/versions endpoints (Phase 3), telemetry
// read, device provisioning, and OTA handlers (Phase 4) attach to this group.
func Register(se *core.ServeEvent, cfg config.Config) {
	g := se.Router.Group("/api/farmon")

	g.GET("/health", func(e *core.RequestEvent) error {
		return e.JSON(http.StatusOK, map[string]any{
			"status": "ok",
			"mode":   string(cfg.Mode),
		})
	})
}
