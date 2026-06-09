package server

import (
	"fmt"

	"github.com/kisinga/majiflow/internal/api"
	"github.com/kisinga/majiflow/internal/config"

	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/apis"
	"github.com/pocketbase/pocketbase/core"
)

// registerSiteHooks guards site ownership and the controller reactivation cap.
//
// Site design lives in draft_topology and is autosaved continuously, so it is NOT
// a device-registration trigger: a controller becomes a registered device only at
// provision (firmware Generate), where the hosting cap is enforced (see
// /provision in internal/api). These hooks only police ownership reassignment and
// the cap on reactivating a deregistered device.
func registerSiteHooks(app core.App, cfg config.Config) {
	app.OnRecordCreateRequest("sites").BindFunc(func(e *core.RecordRequestEvent) error {
		if err := guardOwnerCreate(e); err != nil {
			return err
		}
		return e.Next()
	})

	app.OnRecordUpdateRequest("sites").BindFunc(func(e *core.RecordRequestEvent) error {
		if err := guardOwnerUpdate(e); err != nil {
			return err
		}
		return e.Next()
	})

	// Reactivating a deregistered controller (active false→true) consumes a hosting
	// slot, so it must respect the same cap as a fresh provision.
	app.OnRecordUpdateRequest("controllers").BindFunc(func(e *core.RecordRequestEvent) error {
		if err := capReactivation(e, cfg); err != nil {
			return err
		}
		return e.Next()
	})
}

func isAdmin(auth *core.Record) bool {
	return auth != nil && auth.GetString("role") == "admin"
}

// guardOwnerCreate stops a customer from creating a site owned by someone else.
func guardOwnerCreate(e *core.RecordRequestEvent) error {
	if isAdmin(e.Auth) || e.Auth == nil {
		return nil
	}
	if owner := e.Record.GetString("owner"); owner != "" && owner != e.Auth.Id {
		return apis.NewForbiddenError("cannot assign a site to another user", nil)
	}
	return nil
}

// guardOwnerUpdate stops a customer from reassigning their site away (owner has no
// field rule, so without this a customer could rewrite owner and lose access).
func guardOwnerUpdate(e *core.RecordRequestEvent) error {
	if isAdmin(e.Auth) {
		return nil
	}
	old, err := e.App.FindRecordById("sites", e.Record.Id)
	if err != nil {
		return nil // missing record — let the normal flow surface it
	}
	if e.Record.GetString("owner") != old.GetString("owner") {
		return apis.NewForbiddenError("only an admin can reassign a site", nil)
	}
	return nil
}

// capReactivation enforces the hosting device cap when a controller is flipped
// active=false → true on a managed site.
func capReactivation(e *core.RecordRequestEvent, cfg config.Config) error {
	if !e.Record.GetBool("active") {
		return nil // not activating
	}
	old, err := e.App.FindRecordById("controllers", e.Record.Id)
	if err != nil || old.GetBool("active") {
		return nil // already active (or new) — not a false→true transition
	}
	siteID := e.Record.GetString("site")
	site, err := e.App.FindRecordById("sites", siteID)
	if err != nil || site == nil || !isManaged(site, cfg) {
		return nil
	}
	active, _ := e.App.CountRecords("controllers", dbx.HashExp{"site": siteID, "active": true})
	if cap := api.HostingCap(e.App); int(active)+1 > cap {
		return apis.NewBadRequestError(
			fmt.Sprintf("hosting plan covers up to %d devices per site; remove a device or move to on-prem to add more", cap),
			nil,
		)
	}
	return nil
}

func isManaged(site *core.Record, cfg config.Config) bool {
	if mode := site.GetString("mode"); mode != "" {
		return mode == "managed"
	}
	return cfg.Mode == config.ModeCloud
}
