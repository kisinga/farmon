package telemetry_test

import (
	"testing"
	"time"

	"github.com/kisinga/majiflow/internal/auth"
	"github.com/kisinga/majiflow/internal/telemetry"
	_ "github.com/kisinga/majiflow/migrations" // register collection migrations

	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tests"
)

func TestIngestRollupPrune(t *testing.T) {
	app, err := tests.NewTestApp()
	if err != nil {
		t.Fatal(err)
	}
	defer app.Cleanup()

	// --- seed a site + provisioned controller -------------------------------
	sites, err := app.FindCollectionByNameOrId("sites")
	if err != nil {
		t.Fatalf("sites collection missing (migrations did not run?): %v", err)
	}
	site := core.NewRecord(sites)
	site.Set("name", "Test Site")
	if err := app.Save(site); err != nil {
		t.Fatal(err)
	}

	rawToken, _ := auth.GenerateToken()
	hash, _ := auth.HashToken(rawToken)
	cc, _ := app.FindCollectionByNameOrId("controllers")
	ctrl := core.NewRecord(cc)
	ctrl.Id = "dev1" // device_id is the controllers primary key
	ctrl.Set("site", site.Id)
	ctrl.Set("active", true)
	ctrl.Set("token_hash", hash)
	if err := app.Save(ctrl); err != nil {
		t.Fatal(err)
	}

	// --- ingest 3 samples into one window completed at both tiers ----------
	// 90 min back guarantees the sample's hour-window is strictly before the
	// current hour, so the 1hr rollup's `win < cutoff` fires regardless of the
	// wall-clock minute (a -30min offset flaked when run past HH:30).
	base := time.Now().UTC().Add(-90 * time.Minute).Truncate(5 * time.Minute)
	for i, v := range []float64{10, 20, 30} {
		r := telemetry.Reading{
			Site: site.Id, Ctrl: "dev1", Sensor: "flow", Value: v,
			TS: base.Add(time.Duration(i) * time.Second),
		}
		if err := telemetry.Ingest(app, r); err != nil {
			t.Fatal(err)
		}
	}

	// --- rollup -------------------------------------------------------------
	if err := telemetry.Rollup(app, time.Now()); err != nil {
		t.Fatal(err)
	}
	rows, err := app.FindRecordsByFilter("telemetry_5min", "sensor = 'flow'", "", 0, 0)
	if err != nil {
		t.Fatal(err)
	}
	if len(rows) != 1 {
		t.Fatalf("want 1 telemetry_5min row, got %d", len(rows))
	}
	if got := rows[0].GetFloat("avg"); got != 20 {
		t.Errorf("avg = %v, want 20", got)
	}
	if got := rows[0].GetFloat("min"); got != 10 {
		t.Errorf("min = %v, want 10", got)
	}
	if got := rows[0].GetFloat("max"); got != 30 {
		t.Errorf("max = %v, want 30", got)
	}
	if got := rows[0].GetFloat("count"); got != 3 {
		t.Errorf("count = %v, want 3", got)
	}

	// hourly tier also produced
	hourly, _ := app.FindRecordsByFilter("telemetry_1hr", "sensor = 'flow'", "", 0, 0)
	if len(hourly) != 1 {
		t.Fatalf("want 1 telemetry_1hr row, got %d", len(hourly))
	}
	if got := hourly[0].GetFloat("avg"); got != 20 {
		t.Errorf("hourly avg = %v, want 20 (count-weighted)", got)
	}

	// --- ingest marked the controller online --------------------------------
	c2, err := app.FindRecordById("controllers", "dev1")
	if err != nil {
		t.Fatal(err)
	}
	if !c2.GetBool("online") {
		t.Error("controller should be marked online after ingest")
	}

	// --- token auth round-trip ---------------------------------------------
	if !auth.VerifyToken(hash, rawToken) {
		t.Error("VerifyToken should accept the issued token")
	}
	if auth.VerifyToken(hash, "wrong-token") {
		t.Error("VerifyToken should reject a wrong token")
	}

	// --- prune drops aged raw rows, keeps aggregates ------------------------
	future := time.Now().Add(telemetry.RawRetention + time.Hour)
	if err := telemetry.Prune(app, future); err != nil {
		t.Fatal(err)
	}
	rawLeft, _ := app.FindRecordsByFilter("telemetry_raw", "sensor = 'flow'", "", 0, 0)
	if len(rawLeft) != 0 {
		t.Errorf("expected raw rows pruned, got %d", len(rawLeft))
	}
	aggLeft, _ := app.FindRecordsByFilter("telemetry_5min", "sensor = 'flow'", "", 0, 0)
	if len(aggLeft) != 1 {
		t.Errorf("aggregate rows should survive raw prune, got %d", len(aggLeft))
	}
}
