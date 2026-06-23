package automations

import (
	"time"

	"github.com/pocketbase/pocketbase/core"
)

// RegisterActivity records every automation change as an append-only config_events
// row, so the dashboard Activity timeline shows it attributed to the acting user.
// It runs at the request boundary — RecordRequestEvent carries e.Auth (the actor),
// which the model-layer republish hook (Register) does not — AFTER the write commits
// (e.Next), and stays independent of that republish pipe, which remains a pure
// DB->retained-binary projection. A cascade delete (e.g. a controller removed, which
// deletes its automations) bypasses these request hooks, so wholesale teardown never
// spams the feed.
func RegisterActivity(app core.App) {
	logChange := func(derive func(*core.RecordRequestEvent) string) func(*core.RecordRequestEvent) error {
		return func(e *core.RecordRequestEvent) error {
			if err := e.Next(); err != nil {
				return err
			}
			writeConfigEvent(e, derive(e))
			return nil
		}
	}
	app.OnRecordCreateRequest("automations").BindFunc(logChange(func(*core.RecordRequestEvent) string { return "added" }))
	app.OnRecordUpdateRequest("automations").BindFunc(logChange(changeFromUpdate))
	app.OnRecordDeleteRequest("automations").BindFunc(logChange(func(*core.RecordRequestEvent) string { return "removed" }))
}

// changeFromUpdate separates an enable/disable toggle from a general edit by diffing
// the `enabled` flag against its pre-update value. If the original is unavailable it
// falls back to "edited" — a harmless, honest default.
//
// Original() stays the loaded (pre-edit) DB snapshot here even though we run AFTER
// e.Next(): PocketBase's update path does not re-sync originalData (only create calls
// MarkAsNotNew) — verified in v0.36.6. If a PB bump ever re-syncs on update, this would
// read the new value and every toggle would log as "edited"; capture `was` before
// e.Next() if that happens.
func changeFromUpdate(e *core.RecordRequestEvent) string {
	now := e.Record.GetBool("enabled")
	was := now
	if orig := e.Record.Original(); orig != nil {
		was = orig.GetBool("enabled")
	}
	if now != was {
		if now {
			return "enabled"
		}
		return "disabled"
	}
	return "edited"
}

// writeConfigEvent appends one config_events row from the automation record + the
// acting auth. Best-effort: the operator's change already committed via e.Next, so a
// logging failure must never fail their request — errors are logged, not returned.
func writeConfigEvent(e *core.RecordRequestEvent, change string) {
	coll, err := e.App.FindCollectionByNameOrId("config_events")
	if err != nil {
		return
	}
	rec := core.NewRecord(coll)
	rec.Set("site", e.Record.GetString("site"))
	rec.Set("controller", e.Record.GetString("controller"))
	rec.Set("automation", e.Record.Id)
	rec.Set("name", e.Record.GetString("name"))
	rec.Set("change", change)
	// RFC3339Nano (sub-second): two edits to the same automation within one second
	// would otherwise share a ts, and the feed's Angular @for key (ts + label) would
	// collide on identical rows. Nano keeps each row's key unique and the sort stable.
	rec.Set("ts", time.Now().UTC().Format(time.RFC3339Nano))
	if e.Auth != nil {
		rec.Set("actor", e.Auth.Id)
		rec.Set("issued_role", e.Auth.GetString("role"))
	}
	if err := e.App.Save(rec); err != nil {
		e.App.Logger().Error("config_events write failed", "automation", e.Record.Id, "change", change, "error", err)
	}
}
