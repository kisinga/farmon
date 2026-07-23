package api

import (
	"net/http"
	"slices"
	"strings"

	"github.com/kisinga/majiflow/internal/config"
	"github.com/pocketbase/pocketbase/apis"
	"github.com/pocketbase/pocketbase/core"
)

// RegisterPersona mounts the dev-only persona switcher at /api/farmon/persona.
// It lets an allowlisted account (MAJI_PERSONA_EMAILS) flip its OWN role, org
// and site co-ownership so a single login can drive every UI persona
// (admin / partner / site-owner customer / outsider customer) in testing — no
// fixture accounts. The gate is keyed on the caller's EMAIL, not the current
// role, so a caller switched to customer/partner keeps access and can always
// switch back to admin. An empty allowlist leaves both routes answering 404:
// the feature is indistinguishable from absent in production.
func RegisterPersona(se *core.ServeEvent, cfg config.Config) {
	// GET /api/farmon/persona — capability probe for the switcher UI: whether
	// the caller may switch at all, plus their current role for the indicator.
	se.Router.GET("/api/farmon/persona", func(e *core.RequestEvent) error {
		if err := requirePersona(e, cfg); err != nil {
			return err
		}
		return e.JSON(http.StatusOK, map[string]any{
			"enabled": true,
			"role":    e.Auth.GetString("role"),
		})
	})

	// POST /api/farmon/persona {role, partner?, site?, grant_site?} — apply the
	// persona to the caller's own record (never anyone else's). `partner`
	// present sets the org relation ("" clears); `site` + grant_site adds or
	// removes the caller from that site's owner multi-relation.
	se.Router.POST("/api/farmon/persona", func(e *core.RequestEvent) error {
		if err := requirePersona(e, cfg); err != nil {
			return err
		}
		var body struct {
			Role      string  `json:"role"`
			Partner   *string `json:"partner"`
			Site      string  `json:"site"`
			GrantSite bool    `json:"grant_site"`
		}
		if err := e.BindBody(&body); err != nil {
			return apis.NewBadRequestError("invalid body", err)
		}
		switch body.Role {
		case "admin", "partner", "customer":
		default:
			return apis.NewBadRequestError(`role must be "admin", "partner" or "customer"`, nil)
		}

		// Refetch the caller fresh — the token's cached record lags a switch.
		user, err := e.App.FindRecordById("users", e.Auth.Id)
		if err != nil {
			return apis.NewNotFoundError("user not found", nil)
		}
		user.Set("role", body.Role)

		if body.Partner != nil {
			orgID := strings.TrimSpace(*body.Partner)
			if orgID != "" {
				if _, err := e.App.FindRecordById("partners", orgID); err != nil {
					return apis.NewNotFoundError("partner organization not found", nil)
				}
			}
			user.Set("partner", orgID) // "" clears the org assignment
		}
		if err := e.App.Save(user); err != nil {
			return apis.NewBadRequestError("save failed", err)
		}

		if body.Site != "" {
			site, err := e.App.FindRecordById("sites", body.Site)
			if err != nil {
				return apis.NewNotFoundError("site not found", nil)
			}
			owners := site.GetStringSlice("owner")
			has := slices.Contains(owners, user.Id)
			if body.GrantSite != has {
				if body.GrantSite {
					site.Set("owner", append(owners, user.Id))
				} else {
					site.Set("owner", slices.DeleteFunc(slices.Clone(owners), func(id string) bool { return id == user.Id }))
				}
				if err := e.App.Save(site); err != nil {
					return apis.NewBadRequestError("save failed", err)
				}
			}
		}
		return e.JSON(http.StatusOK, map[string]any{"enabled": true, "role": body.Role})
	})
}

// requirePersona is the single gate for both persona routes: authenticated AND
// allowlisted by email. The email (stable across switches) rather than the role
// is what lets a switched-to-customer caller switch back to admin. 404 (not
// 403) keeps the feature's existence private when the allowlist doesn't
// include the caller — or is unset entirely.
func requirePersona(e *core.RequestEvent, cfg config.Config) error {
	if e.Auth == nil {
		return apis.NewUnauthorizedError("authentication required", nil)
	}
	if !slices.Contains(cfg.PersonaEmails, e.Auth.GetString("email")) {
		return apis.NewNotFoundError("persona switching is not available", nil)
	}
	return nil
}
