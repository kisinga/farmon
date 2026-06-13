package telemetry

import (
	"testing"
	"time"

	_ "github.com/kisinga/majiflow/migrations"
	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tests"
)

// A snapshot reporting fw_version must record the controller's running version and
// flip a release it was deploying to "confirmed" once the version matches — the
// post-reboot success signal for an OTA. A non-matching/other-status release is left
// alone, and a repeat snapshot is idempotent.
func TestReconcileFirmwareConfirmsRelease(t *testing.T) {
	app, err := tests.NewTestApp()
	if err != nil {
		t.Fatal(err)
	}
	defer app.Cleanup()

	save := func(rec *core.Record) {
		if err := app.Save(rec); err != nil {
			t.Fatal(err)
		}
	}
	newRec := func(coll string) *core.Record {
		c, err := app.FindCollectionByNameOrId(coll)
		if err != nil {
			t.Fatal(err)
		}
		return core.NewRecord(c)
	}

	site := newRec("sites")
	site.Set("name", "S")
	save(site)

	ctrl := newRec("controllers")
	ctrl.Id = "dev1"
	ctrl.Set("site", site.Id)
	ctrl.Set("active", true)
	save(ctrl)

	rel := newRec("firmware_releases")
	rel.Set("site", site.Id)
	rel.Set("controller", "dev1")
	rel.Set("version", "v2")
	rel.Set("md5", "abc123")
	rel.Set("status", "deployed")
	save(rel)

	now := time.Now()
	ing := func(payload string) {
		if err := IngestSnapshot(app, site.Id, "dev1", []byte(payload), now); err != nil {
			t.Fatalf("ingest: %v", err)
		}
	}

	// Still on the old version → release stays "deployed", controller records v1.
	ing(`{"ts":1,"readings":{},"text":{"fw_version":"v1"},"system":{"state":"IDLE","queue":0,"safety":false},"routes":[],"outcomes":[]}`)
	got, _ := app.FindRecordById("firmware_releases", rel.Id)
	if got.GetString("status") != "deployed" {
		t.Fatalf("release confirmed too early: %s", got.GetString("status"))
	}
	c, _ := app.FindRecordById("controllers", "dev1")
	if c.GetString("firmware_version") != "v1" {
		t.Fatalf("controller firmware_version = %q, want v1", c.GetString("firmware_version"))
	}

	// Device reboots onto v2 → release confirmed, controller updated.
	ing(`{"ts":2,"readings":{},"text":{"fw_version":"v2"},"system":{"state":"IDLE","queue":0,"safety":false},"routes":[],"outcomes":[]}`)
	got, _ = app.FindRecordById("firmware_releases", rel.Id)
	if got.GetString("status") != "confirmed" {
		t.Fatalf("release not confirmed on version match: %s", got.GetString("status"))
	}
	c, _ = app.FindRecordById("controllers", "dev1")
	if c.GetString("firmware_version") != "v2" {
		t.Fatalf("controller firmware_version = %q, want v2", c.GetString("firmware_version"))
	}

	// Idempotent: a repeat v2 snapshot keeps it confirmed (no error, no flap).
	ing(`{"ts":3,"readings":{},"text":{"fw_version":"v2"},"system":{"state":"IDLE","queue":0,"safety":false},"routes":[],"outcomes":[]}`)
	count, _ := app.CountRecords("firmware_releases",
		dbx.HashExp{"controller": "dev1", "status": "confirmed"})
	if count != 1 {
		t.Fatalf("expected exactly 1 confirmed release, got %d", count)
	}
}
