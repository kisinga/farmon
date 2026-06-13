package telemetry

import (
	"encoding/json"
	"fmt"
	"testing"
	"time"

	_ "github.com/kisinga/majiflow/migrations"
	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tests"
)

// IngestSnapshot must project one snapshot into the shadow + raw history, resolve
// a route's origin actor to a name, derive a state_events row on a state change,
// and reconcile a command from its outcome.
func TestIngestSnapshot(t *testing.T) {
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

	user := newRec("users")
	user.Set("email", "jane@x.com")
	user.Set("password", "password123")
	user.Set("name", "Jane")
	user.Set("role", "customer")
	save(user)

	ctrl := newRec("controllers")
	ctrl.Id = "dev1" // device_id IS the record id
	ctrl.Set("site", site.Id)
	ctrl.Set("active", true)
	save(ctrl)

	auto := newRec("automations")
	auto.Set("site", site.Id)
	auto.Set("controller", "dev1")
	auto.Set("name", "Morning")
	auto.Set("route_key", "r0")
	auto.Set("trigger_type", "time")
	save(auto)

	cmd := newRec("commands")
	cmd.Set("site", site.Id)
	cmd.Set("controller", "dev1")
	cmd.Set("command_id", "c123")
	cmd.Set("status", "sent")
	save(cmd)

	now := time.Now()
	ing := func(payload string) {
		if err := IngestSnapshot(app, site.Id, "dev1", []byte(payload), now); err != nil {
			t.Fatalf("ingest: %v", err)
		}
	}
	// The collapsed shadow: one controller_state doc holding the latest snapshot.
	type tRoute struct {
		ID         int    `json:"id"`
		State      string `json:"state"`
		Origin     string `json:"origin"`
		ActorLabel string `json:"actorLabel"`
	}
	type tSnap struct {
		Readings map[string]float64 `json:"readings"`
		Routes   []tRoute           `json:"routes"`
	}
	loadSnap := func() tSnap {
		d, _ := app.FindFirstRecordByFilter("controller_state", "controller = {:c}", dbx.Params{"c": "dev1"})
		if d == nil {
			t.Fatal("controller_state doc missing")
		}
		var s tSnap
		if err := json.Unmarshal([]byte(d.GetString("snapshot")), &s); err != nil {
			t.Fatalf("snapshot json: %v", err)
		}
		return s
	}

	// Snapshot 1: idle. Establishes the route's prior state + a reading for history.
	ing(`{"ts":1,"readings":{"tank1_level":42.5},"text":{"ip":"1.2.3.4"},"system":{"state":"IDLE","queue":0,"safety":false},"routes":[{"id":0,"state":"IDLE","origin":"SYSTEM","actor":"","reason":""}],"outcomes":[]}`)

	if s := loadSnap(); s.Readings["tank1_level"] != 42.5 {
		t.Errorf("tank1_level not 42.5 in doc: %v", s.Readings)
	}
	rawCount, _ := app.CountRecords("telemetry_raw", dbx.HashExp{"sensor": "tank1_level"})
	if rawCount != 1 {
		t.Errorf("expected 1 raw row, got %d", rawCount)
	}

	// Snapshot 2: route 0 RUNNING, started manually by Jane; command c123 applied.
	ing(fmt.Sprintf(`{"ts":2,"readings":{},"system":{"state":"RUNNING","queue":0,"safety":false},"routes":[{"id":0,"state":"RUNNING","origin":"MANUAL","actor":%q,"reason":""}],"outcomes":[{"command_id":"c123","result":"APPLIED","reason":""}]}`, user.Id))

	r := loadSnap().Routes[0]
	if r.State != "RUNNING" || r.Origin != "MANUAL" || r.ActorLabel != "Jane" {
		t.Errorf("route 0 wrong: %+v", r)
	}
	ev, _ := app.FindFirstRecordByFilter("state_events",
		"controller = {:c} && to_state = {:s}", dbx.Params{"c": "dev1", "s": "RUNNING"})
	if ev == nil || ev.GetString("from_state") != "IDLE" {
		t.Errorf("derived IDLE->RUNNING event missing")
	}
	cmd2, _ := app.FindFirstRecordByFilter("commands", "command_id = {:c}", dbx.Params{"c": "c123"})
	if cmd2 == nil || cmd2.GetString("status") != "done" {
		t.Errorf("command not reconciled to done: %v", cmd2)
	}

	// Snapshot 3: route restarted by the automation → actor resolves to its name.
	ing(fmt.Sprintf(`{"ts":3,"readings":{},"system":{"state":"RUNNING","queue":0,"safety":false},"routes":[{"id":0,"state":"PREPARING","origin":"AUTOMATION","actor":%q,"reason":""}],"outcomes":[]}`, auto.Id))
	r = loadSnap().Routes[0]
	if r.Origin != "AUTOMATION" || r.ActorLabel != "Morning" {
		t.Errorf("automation label wrong: %+v", r)
	}
}
