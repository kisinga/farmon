// Package billing implements the tenant-billing spine: cycles, invoices,
// manual payments, and the arrears→valve automation. See
// docs/billing-module-architecture.md (domain model) and
// docs/billing-shengda-implementation-spec.md (this implementation).
package billing

import (
	"slices"

	"github.com/kisinga/majiflow/internal/entitlements"
	"github.com/pocketbase/pocketbase/core"
)

// CapabilityTenantBilling gates the whole module (architecture §11.2).
const CapabilityTenantBilling = "tenant_billing"

// HasCapability reports whether a site is entitled to a capability. A site's
// feature set is CORE ∪ packs.capabilities ∪ site.addons (migration 34); CORE
// grants nothing billing-related, so only the two paid levers are checked.
// Entitlement fields are admin-only writes (sites_hooks guardEntitlement*), so
// whatever is stored here is authoritative. The single evaluator lives in
// internal/entitlements; on any resolution error this fails closed (false).
func HasCapability(app core.App, siteID, capability string) bool {
	caps, _, err := entitlements.Set(app, siteID)
	if err != nil {
		return false
	}
	return slices.Contains(caps, capability)
}
