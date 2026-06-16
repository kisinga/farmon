package api

import "github.com/pocketbase/pocketbase/core"

// CoreCapabilities is the platform base — what every hosted (subscribed) site gets
// without buying a pack. It is NOT local device function: a controller keeps
// controlling, protecting the pump, and running already-baked automations on-site
// with no subscription at all, and that firmware behaviour is never entitlement-
// gated. CORE governs the platform layer (offsite access, the dashboard,
// notifications, basic reports); packs add premium features on top.
//
// Size and segment never appear here: size sets price/quota, segment sets the
// dashboard skin, neither grants a feature.
//
// These keys are the contract with the frontend EntitlementsStore and the TS
// pricing model. Keep the lists in sync — Go and TS cannot share code.
var CoreCapabilities = []string{
	"dashboard",
	"control",
	"schedule",
	"alerts.sms",
	"alerts.whatsapp",
	"reports.basic",
	"pump.safety",
}

// Capabilities computes a site's full capability set:
//
//	CORE ∪ ⋃ packs.capabilities ∪ site.addons
//
// Single source of truth for what a site may do; the frontend mirrors it for UX
// only. A missing or unreadable pack is skipped rather than fatal — a half-resolved
// entitlement degrades to fewer features, never an error.
func Capabilities(app core.App, site *core.Record) map[string]bool {
	caps := make(map[string]bool, len(CoreCapabilities)+8)
	for _, c := range CoreCapabilities {
		caps[c] = true
	}
	if site == nil {
		return caps
	}

	var addons []string
	_ = site.UnmarshalJSONField("addons", &addons)
	for _, c := range addons {
		caps[c] = true
	}

	packIDs := site.GetStringSlice("packs")
	if len(packIDs) == 0 {
		return caps
	}
	packs, err := app.FindRecordsByIds("packs", packIDs)
	if err != nil {
		return caps
	}
	for _, p := range packs {
		var pc []string
		_ = p.UnmarshalJSONField("capabilities", &pc)
		for _, c := range pc {
			caps[c] = true
		}
	}
	return caps
}

// Can reports whether a site is entitled to a capability. Enforce premium data and
// actions through this, the same way ownership is enforced in the site hooks.
func Can(app core.App, site *core.Record, capability string) bool {
	return Capabilities(app, site)[capability]
}
