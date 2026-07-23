package api

import (
	"net/http"

	"github.com/kisinga/majiflow/internal/entitlements"
	"github.com/pocketbase/pocketbase/apis"
	"github.com/pocketbase/pocketbase/core"
)

// RegisterCapabilities mounts the site-entitlement probe under /api/farmon/sites.
// The dashboard calls it to gate capability-gated pages and pick the widget set.
func RegisterCapabilities(se *core.ServeEvent) {
	g := se.Router.Group("/api/farmon/sites")

	// GET /{id}/capabilities — the site's resolved feature set: capabilities
	// (site.addons ∪ packs.capabilities) and widget ids (packs.widget_ids),
	// both sorted + deduplicated by internal/entitlements.
	g.GET("/{id}/capabilities", func(e *core.RequestEvent) error {
		id := e.Request.PathValue("id")
		// Auth first: requireSiteAccess 401s nil auth, 400s an empty id, and
		// 404s a missing site — checking it before any existence probe keeps an
		// unauthenticated caller from telling valid site ids apart from invalid
		// ones (404 vs 401). It also fetches the site, so no pre-fetch here.
		if err := requireSiteAccess(e, id); err != nil {
			return err
		}
		caps, widgetIDs, err := entitlements.Set(e.App, id)
		if err != nil {
			return apis.NewNotFoundError("site not found", err)
		}
		return e.JSON(http.StatusOK, map[string]any{
			"capabilities": caps,
			"widget_ids":   widgetIDs,
		})
	})
}
