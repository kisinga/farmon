package server

import (
	"github.com/kisinga/majiflow/internal/api"
	"github.com/pocketbase/pocketbase/apis"
	"github.com/pocketbase/pocketbase/core"
)

// registerUserHooks guards user-account mutations so partners can manage only
// their own customers without being able to escalate roles or reassign partners.
func registerUserHooks(app core.App) {
	app.OnRecordCreateRequest("users").BindFunc(func(e *core.RecordRequestEvent) error {
		return guardUserCreate(e)
	})

	app.OnRecordUpdateRequest("users").BindFunc(func(e *core.RecordRequestEvent) error {
		return guardUserUpdate(e)
	})
}

func guardUserCreate(e *core.RecordRequestEvent) error {
	if api.IsAdmin(e.Auth) {
		return e.Next()
	}
	if e.Auth == nil {
		return apis.NewUnauthorizedError("authentication required", nil)
	}
	if !api.IsPartner(e.Auth) {
		return apis.NewForbiddenError("only admins and partners can create accounts", nil)
	}
	if e.Record.GetString("role") != "customer" {
		return apis.NewForbiddenError("partners can only create customers", nil)
	}
	if e.Record.GetString("partner") != e.Auth.GetString("partner") {
		return apis.NewForbiddenError("customer must be assigned to your partner organization", nil)
	}
	return e.Next()
}

func guardUserUpdate(e *core.RecordRequestEvent) error {
	if api.IsAdmin(e.Auth) {
		return e.Next()
	}
	if e.Auth == nil {
		return apis.NewUnauthorizedError("authentication required", nil)
	}

	old, err := e.App.FindRecordById("users", e.Record.Id)
	if err != nil {
		return e.Next() // missing record — let the normal flow surface it
	}

	// Non-admins can never change role or partner assignment.
	if e.Record.GetString("role") != old.GetString("role") {
		return apis.NewForbiddenError("only admins can change roles", nil)
	}
	if e.Record.GetString("partner") != old.GetString("partner") {
		return apis.NewForbiddenError("only admins can reassign partners", nil)
	}

	// Users can update their own profile fields.
	if e.Auth.Id == e.Record.Id {
		return e.Next()
	}

	// Partners can update only customers in their own organization.
	if api.IsPartner(e.Auth) {
		if old.GetString("role") != "customer" || old.GetString("partner") != e.Auth.GetString("partner") {
			return apis.NewForbiddenError("not your customer", nil)
		}
		return e.Next()
	}

	return apis.NewForbiddenError("only admins and partners can update accounts", nil)
}
