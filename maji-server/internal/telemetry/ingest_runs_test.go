package telemetry

import (
	"fmt"
	"testing"
	"time"

	_ "github.com/kisinga/majiflow/migrations"
	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tests"
)

// The runs[] array of a snapshot is the device's durable outbox of closed runs.
// IngestSnapshot must persist each into the immutable billing ledger idempotently
// (a re-asserted run is a no-op), carry both axes (duration always; litres when
// metered), resolve the actor label, and — critically — keep the ledger gap-free so
// the high-water-mark never passes an un-persisted run.
func TestIngestRuns(t *testing.T) {
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
	ctrl.Id = "dev1"
	ctrl.Set("site", site.Id)
	ctrl.Set("active", true)
	save(ctrl)

	now := time.Now()
	ing := func(payload string) {
		if err := IngestSnapshot(app, site.Id, "dev1", []byte(payload), now, nil); err != nil {
			t.Fatalf("ingest: %v", err)
		}
	}
	runsOf := func() []*core.Record {
		recs, _ := app.FindRecordsByFilter("runs", "controller = {:c}", "epoch,seq", 100, 0,
			dbx.Params{"c": "dev1"})
		return recs
	}

	// One metered run (Jane) + one unmetered run (no flow sensor) in the outbox.
	ing(fmt.Sprintf(`{"ts":1,"readings":{},"system":{"state":"IDLE","queue":0,"safety":false},"routes":[],"outcomes":[],"runs":[
		{"run_id":"100:1","route":0,"epoch":100,"seq":1,"origin":"MANUAL","actor":%q,"started_at":1700000000,"ended_at":1700000300,"duration_s":300,"stop_reason":"VOLUME_REACHED","start_litres":1000,"end_litres":1100,"metered":true,"fault":""},
		{"run_id":"100:2","route":1,"epoch":100,"seq":2,"origin":"SYSTEM","actor":"","started_at":1700003600,"ended_at":1700004200,"duration_s":600,"stop_reason":"DURATION_REACHED","start_litres":0,"end_litres":0,"metered":false,"fault":""}
	]}`, user.Id))

	recs := runsOf()
	if len(recs) != 2 {
		t.Fatalf("expected 2 runs, got %d", len(recs))
	}
	r0 := recs[0]
	if r0.GetString("run_id") != "100:1" || !r0.GetBool("metered") ||
		r0.GetFloat("end_litres")-r0.GetFloat("start_litres") != 100 {
		t.Errorf("metered run wrong: %+v", r0.FieldsData())
	}
	if r0.GetString("actor_label") != "Jane" {
		t.Errorf("actor_label not resolved: %q", r0.GetString("actor_label"))
	}
	if r0.GetInt("duration_s") != 300 {
		t.Errorf("duration_s wrong: %d", r0.GetInt("duration_s"))
	}
	if recs[1].GetBool("metered") {
		t.Errorf("run 2 should be unmetered (time-only)")
	}
	if recs[1].GetInt("duration_s") != 600 {
		t.Errorf("unmetered run still carries duration: got %d", recs[1].GetInt("duration_s"))
	}

	// High-water-mark = the max (epoch, seq) — what gets published on runs_ack.
	if e, s, ok := HighWaterRun(app, "dev1"); !ok || e != 100 || s != 2 {
		t.Errorf("high-water wrong: epoch=%d seq=%d ok=%v", e, s, ok)
	}

	// Idempotency: the device keeps re-asserting unacked runs. Re-ingesting the same
	// outbox (here with run 1 only, as if run 2 isn't acked yet) must not duplicate.
	ing(`{"ts":2,"readings":{},"system":{"state":"IDLE","queue":0,"safety":false},"routes":[],"outcomes":[],"runs":[
		{"run_id":"100:1","route":0,"epoch":100,"seq":1,"origin":"MANUAL","actor":"x","started_at":1700000000,"ended_at":1700000300,"duration_s":300,"stop_reason":"VOLUME_REACHED","start_litres":1000,"end_litres":1100,"metered":true,"fault":""}
	]}`)
	if recs := runsOf(); len(recs) != 2 {
		t.Errorf("re-asserted run duplicated: now %d rows", len(recs))
	}
}

// Gap-safe persistence: if a run in the middle of the batch fails to write, the
// loop must STOP, so the ledger never gets a hole below the high-water-mark (which
// would let the ack pass an un-persisted, billable run). Here seq 2 has an
// over-length run_id (fails the Max:40 field validation), so seq 3 must not land.
func TestIngestRunsGapSafe(t *testing.T) {
	app, err := tests.NewTestApp()
	if err != nil {
		t.Fatal(err)
	}
	defer app.Cleanup()

	mk := func(coll string, set map[string]any) *core.Record {
		c, _ := app.FindCollectionByNameOrId(coll)
		r := core.NewRecord(c)
		for k, v := range set {
			r.Set(k, v)
		}
		if err := app.Save(r); err != nil {
			t.Fatal(err)
		}
		return r
	}
	site := mk("sites", map[string]any{"name": "S"})
	cc, _ := app.FindCollectionByNameOrId("controllers")
	ctrl := core.NewRecord(cc)
	ctrl.Id = "dev1" // device_id IS the record id; must be set before first save
	ctrl.Set("site", site.Id)
	ctrl.Set("active", true)
	if err := app.Save(ctrl); err != nil {
		t.Fatal(err)
	}

	tooLong := "200:2-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" // 48 chars > Max:40 -> Save fails
	payload := fmt.Sprintf(`{"ts":1,"readings":{},"system":{"state":"IDLE"},"routes":[],"outcomes":[],"runs":[
		{"run_id":"200:1","route":0,"epoch":200,"seq":1,"metered":true,"start_litres":0,"end_litres":10},
		{"run_id":%q,"route":0,"epoch":200,"seq":2,"metered":true,"start_litres":10,"end_litres":20},
		{"run_id":"200:3","route":0,"epoch":200,"seq":3,"metered":true,"start_litres":20,"end_litres":30}
	]}`, tooLong)
	if err := IngestSnapshot(app, site.Id, "dev1", []byte(payload), time.Now(), nil); err != nil {
		t.Fatalf("ingest: %v", err)
	}

	// Only seq 1 may persist: seq 2 fails, the loop breaks before seq 3.
	n, _ := app.CountRecords("runs", dbx.HashExp{"controller": "dev1"})
	if n != 1 {
		t.Fatalf("expected only seq 1 persisted (gap-safe), got %d rows", n)
	}
	if _, s, _ := HighWaterRun(app, "dev1"); s != 1 {
		t.Errorf("high-water must stay at the last contiguous run (seq 1), got seq %d", s)
	}
}

// The runs ledger is the billing source of truth: it must be retention-exempt.
// Prune deletes old telemetry but must never touch runs, regardless of how old.
func TestRunsLedgerRetentionExempt(t *testing.T) {
	app, err := tests.NewTestApp()
	if err != nil {
		t.Fatal(err)
	}
	defer app.Cleanup()

	mk := func(coll string, set map[string]any) *core.Record {
		c, _ := app.FindCollectionByNameOrId(coll)
		r := core.NewRecord(c)
		for k, v := range set {
			r.Set(k, v)
		}
		if err := app.Save(r); err != nil {
			t.Fatal(err)
		}
		return r
	}
	site := mk("sites", map[string]any{"name": "S"})
	cc, _ := app.FindCollectionByNameOrId("controllers")
	ctrl := core.NewRecord(cc)
	ctrl.Id = "dev1" // device_id IS the record id; must be set before first save
	ctrl.Set("site", site.Id)
	ctrl.Set("active", true)
	if err := app.Save(ctrl); err != nil {
		t.Fatal(err)
	}

	ancient := time.Now().Add(-1000 * 24 * time.Hour) // older than every retention window
	mk("runs", map[string]any{
		"site": site.Id, "controller": "dev1", "route": 0, "run_id": "1:1",
		"epoch": 1, "seq": 1, "started_at": ancient.UTC().Format(time.RFC3339),
		"duration_s": 60, "metered": true, "start_litres": 0, "end_litres": 5,
	})
	mk("telemetry_raw", map[string]any{
		"site": site.Id, "controller": "dev1", "sensor": "x", "value": 1,
		"ts": ancient.UTC().Format(time.RFC3339),
	})

	if err := Prune(app, time.Now()); err != nil {
		t.Fatalf("prune: %v", err)
	}

	if n, _ := app.CountRecords("runs", dbx.HashExp{"controller": "dev1"}); n != 1 {
		t.Errorf("runs ledger was pruned (got %d, want 1) — billing data must be retention-exempt", n)
	}
	// Sanity: Prune did run (the ancient raw sample is gone).
	if n, _ := app.CountRecords("telemetry_raw", dbx.HashExp{"controller": "dev1"}); n != 0 {
		t.Errorf("expected ancient telemetry_raw pruned, got %d", n)
	}
}
