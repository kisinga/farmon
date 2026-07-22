// Package billing implements the tenant-billing spine: cycles, invoices,
// manual payments, and the arrears→valve automation. See
// docs/billing-module-architecture.md (domain model) and
// docs/billing-shengda-implementation-spec.md (this implementation).
package billing

import (
	"encoding/json"
	"slices"

	"github.com/pocketbase/pocketbase/core"
)

// CapabilityTenantBilling gates the whole module (architecture §11.2).
const CapabilityTenantBilling = "tenant_billing"

// HasCapability reports whether a site is entitled to a capability. A site's
// feature set is CORE ∪ packs.capabilities ∪ site.addons (migration 34); CORE
// grants nothing billing-related, so only the two paid levers are checked.
// Entitlement fields are admin-only writes (sites_hooks guardEntitlement*), so
// whatever is stored here is authoritative.
func HasCapability(app core.App, siteID, capability string) bool {
	site, err := app.FindRecordById("sites", siteID)
	if err != nil || site == nil {
		return false
	}
	if slices.Contains(jsonStrings(site.Get("addons")), capability) {
		return true
	}
	for _, packID := range site.GetStringSlice("packs") {
		pack, err := app.FindRecordById("packs", packID)
		if err != nil || pack == nil {
			continue
		}
		if slices.Contains(jsonStrings(pack.Get("capabilities")), capability) {
			return true
		}
	}
	return false
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
