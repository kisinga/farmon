package server

import (
	"log"
	"os"

	"github.com/pocketbase/pocketbase/core"
)

// seedAdmin creates a first app login (a `users` record, role=admin) from
// MAJI_ADMIN_EMAIL / MAJI_ADMIN_PASSWORD when both are set and the user does
// not already exist. This is the app-level login used by the SPA — distinct
// from the PocketBase superuser that guards the /_/ dashboard.
//
// Dev convenience only: in production, create users through the UI.
func seedAdmin(app core.App) {
	email := os.Getenv("MAJI_ADMIN_EMAIL")
	pass := os.Getenv("MAJI_ADMIN_PASSWORD")
	if email == "" || pass == "" {
		return
	}
	if existing, _ := app.FindAuthRecordByEmail("users", email); existing != nil {
		return
	}
	users, err := app.FindCollectionByNameOrId("users")
	if err != nil {
		log.Printf("seedAdmin: users collection missing: %v", err)
		return
	}
	rec := core.NewRecord(users)
	rec.SetEmail(email)
	rec.SetPassword(pass)
	rec.Set("role", "admin")
	rec.Set("verified", true)
	if err := app.Save(rec); err != nil {
		log.Printf("seedAdmin: %v", err)
		return
	}
	log.Printf("seedAdmin: created admin login %s", email)
}
