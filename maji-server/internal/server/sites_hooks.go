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
		if err := guardEntitlementWrite(e); err != nil {
			return err
		}
		return e.Next()
	})

	app.OnRecordUpdateRequest("sites").BindFunc(func(e *core.RecordRequestEvent) error {
		if err := guardOwnerUpdate(e); err != nil {
			return err
		}
		if err := guardEntitlementWrite(e); err != nil {
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

// guardOwnerCreate stops a customer from creating a site with anyone but
// themselves among its owners. owner is a multi-relation (co-owners), so a
// non-admin may seed only an empty set or one containing solely themselves.
func guardOwnerCreate(e *core.RecordRequestEvent) error {
	if api.IsAdmin(e.Auth) || e.Auth == nil {
		return nil
	}
	for _, owner := range e.Record.GetStringSlice("owner") {
		if owner != e.Auth.Id {
			return apis.NewForbiddenError("cannot assign a site to another user", nil)
		}
	}
	return nil
}

// guardOwnerUpdate stops a customer from changing a site's co-owner set (owner has
// no field rule, so without this a customer could rewrite it and lock others out
// or remove themselves). Only admins assign co-owners; order is irrelevant.
func guardOwnerUpdate(e *core.RecordRequestEvent) error {
	if api.IsAdmin(e.Auth) {
		return nil
	}
	old, err := e.App.FindRecordById("sites", e.Record.Id)
	if err != nil {
		return nil // missing record — let the normal flow surface it
	}
	if !sameStringSet(e.Record.GetStringSlice("owner"), old.GetStringSlice("owner")) {
		return apis.NewForbiddenError("only an admin can reassign a site", nil)
	}
	return nil
}

// sameStringSet reports whether two string lists hold the same members, ignoring
// order and duplicates. Used to detect ownership and entitlement changes.
func sameStringSet(a, b []string) bool {
	set := make(map[string]struct{}, len(a))
	for _, id := range a {
		set[id] = struct{}{}
	}
	seen := make(map[string]struct{}, len(b))
	for _, id := range b {
		if _, ok := set[id]; !ok {
			return false
		}
		seen[id] = struct{}{}
	}
	return len(seen) == len(set)
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

// guardEntitlementWrite blocks a non-admin from setting or changing the sold
// entitlement fields (packs, addons, price_override). The site UpdateRule lets an
// owner edit their own site, so without this a customer could self-grant paid
// features. segment is intentionally exempt — it is the dashboard skin a customer
// picks at onboarding, not a paid lever.
func guardEntitlementWrite(e *core.RecordRequestEvent) error {
	if api.IsAdmin(e.Auth) {
		return nil
	}
	var old *core.Record
	if e.Record.Id != "" {
		old, _ = e.App.FindRecordById("sites", e.Record.Id)
	}
	oldPacks, oldAddons, oldOverride := entitlementFields(old)
	newPacks, newAddons, newOverride := entitlementFields(e.Record)

	if !sameStringSet(newPacks, oldPacks) {
		return apis.NewForbiddenError("only an admin can change a site's packs", nil)
	}
	if !sameStringSet(newAddons, oldAddons) {
		return apis.NewForbiddenError("only an admin can change a site's addons", nil)
	}
	if newOverride != oldOverride {
		return apis.NewForbiddenError("only an admin can set a site's price override", nil)
	}
	return nil
}

// entitlementFields reads the three sold fields off a site record; a nil record
// (a create) yields zero values, so an attempt to seed any of them is rejected.
func entitlementFields(r *core.Record) (packs, addons []string, priceOverride float64) {
	if r == nil {
		return nil, nil, 0
	}
	packs = r.GetStringSlice("packs")
	_ = r.UnmarshalJSONField("addons", &addons)
	priceOverride = r.GetFloat("price_override")
	return packs, addons, priceOverride
}
