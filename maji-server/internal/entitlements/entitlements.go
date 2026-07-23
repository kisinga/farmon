// Package entitlements resolves a site's effective feature set: capabilities
// (site.addons ∪ packs.capabilities) and the dashboard widget ids those packs
// light up (packs.widget_ids). See migrations 33/34 for the storage model.
package entitlements

import (
	"encoding/json"
	"slices"

	"github.com/pocketbase/pocketbase/core"
)

// Set loads the site and returns its resolved capability and widget-id sets,
// sorted and deduplicated (stable output keeps tests and client diffs clean).
// Capabilities come from the site's addons JSON plus every related pack's
// capabilities JSON; widget ids are the union of every related pack's
// widget_ids JSON. Missing packs are skipped. Entitlement fields are
// admin-only writes (sites_hooks guardEntitlement*), so whatever is stored
// here is authoritative.
func Set(app core.App, siteID string) (capabilities []string, widgetIDs []string, err error) {
	site, err := app.FindRecordById("sites", siteID)
	if err != nil || site == nil {
		return nil, nil, err
	}
	caps := jsonStrings(site.Get("addons"))
	var widgets []string
	for _, packID := range site.GetStringSlice("packs") {
		pack, err := app.FindRecordById("packs", packID)
		if err != nil || pack == nil {
			continue
		}
		caps = append(caps, jsonStrings(pack.Get("capabilities"))...)
		widgets = append(widgets, jsonStrings(pack.Get("widget_ids"))...)
	}
	return sortedUnique(caps), sortedUnique(widgets), nil
}

// sortedUnique returns the values sorted with duplicates removed (never nil,
// so JSON responses render [] rather than null).
func sortedUnique(vs []string) []string {
	out := slices.Compact(slices.Sorted(slices.Values(vs)))
	if out == nil {
		out = []string{}
	}
	return out
}

// jsonStrings normalizes a JSON field value (raw bytes or decoded) to []string.
func jsonStrings(v any) []string {
	raw, err := json.Marshal(v)
	if err != nil {
		return nil
	}
	var out []string
	if err := json.Unmarshal(raw, &out); err != nil {
		return nil
	}
	return out
}
