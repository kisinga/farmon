//go:build cloud

// Package tenant holds multi-tenant logic. Every file is guarded by the `cloud`
// build tag, so the edge binary excludes this package entirely.
package tenant

import "github.com/pocketbase/pocketbase"

// Register installs multi-tenant hooks (per-owner record isolation, tenant
// provisioning, billing). Implemented in Phase 2+.
func Register(app *pocketbase.PocketBase) {
	_ = app
}
