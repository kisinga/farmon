package api

import (
	"io"
	"net/http"
	"regexp"
	"strings"

	"github.com/pocketbase/pocketbase/apis"
	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tools/filesystem"
)

// partnerLogoMaxSize mirrors the partners.logo FileField cap; checked at the
// endpoint so an oversize upload is rejected before it touches storage.
const partnerLogoMaxSize = 2 * 1024 * 1024 // 2 MB

// partnerLogoMimeTypes is the endpoint's upload allowlist — deliberately
// narrower than the partners.logo FileField (which is admin-only). SVG is
// excluded: /api/files serves uploads inline on the API origin, so an SVG
// opened directly would execute script in the SPA origin (stored XSS), and
// the logo propagates to every customer of the org via /api/farmon/branding.
// The endpoint checks the declared content type; the collection field
// additionally sniffs the real content on save, so a mislabelled payload
// still fails.
var partnerLogoMimeTypes = map[string]bool{
	"image/jpeg": true,
	"image/png":  true,
	"image/webp": true,
}

var brandColorRe = regexp.MustCompile(`^#[0-9a-fA-F]{6}$`)

// RegisterPartner mounts the partner self-serve org profile under
// /api/farmon/partner. The partners collection rules stay admin-only; these
// routes are the ONLY partner path to their own org record (the same pattern
// as /account for users). The org is always resolved from e.Auth.partner —
// never from the request body — so a partner can only ever touch their own org.
func RegisterPartner(se *core.ServeEvent) {
	g := se.Router.Group("/api/farmon/partner")

	// GET /org — the caller's own org record (name, slug, logo, brand colors).
	g.GET("/org", func(e *core.RequestEvent) error {
		org, err := partnerOrg(e)
		if err != nil {
			return err
		}
		return e.JSON(http.StatusOK, partnerOrgJSON(org))
	})

	// PATCH /org {name, brand_primary, brand_accent} — partial update of the
	// caller's own org. Slug is NOT editable here (it keys nothing the partner
	// owns, and changing it is an admin act). Empty colors clear the override.
	g.PATCH("/org", func(e *core.RequestEvent) error {
		org, err := partnerOrg(e)
		if err != nil {
			return err
		}
		var body struct {
			Name         *string `json:"name"`
			BrandPrimary *string `json:"brand_primary"`
			BrandAccent  *string `json:"brand_accent"`
		}
		if err := e.BindBody(&body); err != nil {
			return apis.NewBadRequestError("invalid body", err)
		}
		if body.Name != nil {
			name := strings.TrimSpace(*body.Name)
			if name == "" {
				return apis.NewBadRequestError("name cannot be empty", nil)
			}
			org.Set("name", name)
		}
		for _, c := range []struct {
			field string
			value *string
		}{{"brand_primary", body.BrandPrimary}, {"brand_accent", body.BrandAccent}} {
			if c.value == nil {
				continue
			}
			v := strings.TrimSpace(*c.value)
			if v != "" && !brandColorRe.MatchString(v) {
				return apis.NewBadRequestError(c.field+" must be a #rrggbb hex color", nil)
			}
			org.Set(c.field, v)
		}
		if err := e.App.Save(org); err != nil {
			return apis.NewBadRequestError("save failed", err)
		}
		return e.JSON(http.StatusOK, partnerOrgJSON(org))
	})

	// POST /org/logo (multipart: logo) — replace the org logo. Server-side
	// type/size checks mirror the firmware-upload pattern: 2 MB cap, raster
	// image mime only (no SVG — stored-XSS vector, see partnerLogoMimeTypes).
	// The org is resolved from auth, so there is no way to aim the upload at
	// another org.
	g.POST("/org/logo", func(e *core.RequestEvent) error {
		org, err := partnerOrg(e)
		if err != nil {
			return err
		}
		_, fh, err := e.Request.FormFile("logo")
		if err != nil {
			return apis.NewBadRequestError("logo file is required", err)
		}
		if !partnerLogoMimeTypes[fh.Header.Get("Content-Type")] {
			return apis.NewBadRequestError("logo must be a jpeg, png or webp image", nil)
		}
		src, err := fh.Open()
		if err != nil {
			return apis.NewBadRequestError("cannot read upload", err)
		}
		// Read at most cap+1: an oversize payload is rejected from the actual
		// byte count, not the client-declared header.
		data, err := io.ReadAll(io.LimitReader(src, partnerLogoMaxSize+1))
		_ = src.Close()
		if err != nil {
			return apis.NewBadRequestError("cannot read upload", err)
		}
		if len(data) == 0 {
			return apis.NewBadRequestError("logo is empty", nil)
		}
		if len(data) > partnerLogoMaxSize {
			return apis.NewBadRequestError("logo exceeds the 2 MB limit", nil)
		}

		file, err := filesystem.NewFileFromBytes(data, fh.Filename)
		if err != nil {
			return apis.NewApiError(http.StatusInternalServerError, "failed to read upload", err)
		}
		org.Set("logo", file)
		if err := e.App.Save(org); err != nil {
			return apis.NewBadRequestError("save failed", err)
		}
		return e.JSON(http.StatusOK, partnerOrgJSON(org))
	})
}

// partnerOrg authenticates the caller as a partner and resolves their org from
// the server-side auth record — the single org-resolution point for every
// partner route, so scoping can never be spoofed through the request body.
func partnerOrg(e *core.RequestEvent) (*core.Record, error) {
	if e.Auth == nil {
		return nil, apis.NewUnauthorizedError("authentication required", nil)
	}
	if !IsPartner(e.Auth) {
		return nil, apis.NewForbiddenError("partner role required", nil)
	}
	orgID := e.Auth.GetString("partner")
	if orgID == "" {
		return nil, apis.NewNotFoundError("no partner organization assigned", nil)
	}
	org, err := e.App.FindRecordById("partners", orgID)
	if err != nil {
		return nil, apis.NewNotFoundError("partner organization not found", nil)
	}
	return org, nil
}

// partnerOrgJSON is the public projection of an org record, identical in shape
// to what /api/farmon/branding serves (plus the id), so the frontend can reuse
// one type for both.
func partnerOrgJSON(org *core.Record) map[string]any {
	logo := org.GetString("logo")
	logoURL := ""
	if logo != "" {
		logoURL = "/api/files/" + org.Collection().Id + "/" + org.Id + "/" + logo
	}
	return map[string]any{
		"id":            org.Id,
		"name":          org.GetString("name"),
		"slug":          org.GetString("slug"),
		"logo_url":      logoURL,
		"brand_primary": org.GetString("brand_primary"),
		"brand_accent":  org.GetString("brand_accent"),
	}
}
