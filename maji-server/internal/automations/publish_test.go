package automations

import (
	"bytes"
	"encoding/json"
	"testing"

	_ "github.com/kisinga/majiflow/migrations"
	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tests"
)

// capturePub records the single retained publish PublishConfigForController makes,
// so the test can assert the topic, retain/qos, and the exact /config payload bytes
// (the server is the only hasher — the device never sees anything but these bytes).
type capturePub struct {
	topic   string
	payload []byte
	retain  bool
	qos     byte
	calls   int
}

func (c *capturePub) Publish(topic string, payload []byte, retain bool, qos byte) error {
	c.topic, c.payload, c.retain, c.qos = topic, payload, retain, qos
	c.calls++
	return nil
}

// Cross-language drift guard: the Go encoder must produce the same bytes as the
// TS reference encoder (src/lib/automation-wire.ts). This golden vector is the
// identical case asserted in test/automation-wire.test.ts.
func TestEncodeItemsGoldenVector(t *testing.T) {
	item := Item{
		ID:      "abc123def456ghi", // 15-char id, null-padded to 16 in the trailing block
		Enabled: true, Trigger: "time", DaysMask: 0b0101010, LevelThresholdPct: 80,
		RouteIndex: 3, TimeMin: 6*60 + 30, OverrideMask: 0b10001,
		OvSourceMinPct: 20, OvDestMaxPct: 95,
		OvMaxRuntimeMin: 45, OvTargetDurationS: 1800, OvTargetVolumeL: 500,
	}
	got := EncodeItems(0x0d52, []Item{item})

	want := []byte{
		// header
		0x01, 0xa0, // magic 0xa001 LE
		0x52, 0x0d, // route_set_version 0x0d52 LE
		0x01, 0x00, // count, pad
		// record
		0x01,       // enabled
		0x00,       // trigger_type time
		0b0101010,  // days_mask
		80,         // level_threshold_pct
		0x03, 0x00, // route_index 3 LE
		0x86, 0x01, // time_min 390 LE
		0b10001,  // override_mask
		20,       // ov_source_min_pct
		95,       // ov_dest_max_pct
		0x00,     // pad
		45, 0x00, // ov_max_runtime_min 45 LE
		0x08, 0x07, // ov_target_duration_s 1800 LE
		0xf4, 0x01, 0x00, 0x00, // ov_target_volume_l 500 LE
		// trailing id block: "abc123def456ghi" + NUL pad to 16
		'a', 'b', 'c', '1', '2', '3', 'd', 'e', 'f', '4', '5', '6', 'g', 'h', 'i', 0x00,
	}
	if !bytes.Equal(got, want) {
		t.Fatalf("encoded bytes mismatch\n got: % x\nwant: % x", got, want)
	}
}

func TestEncodeItemsEmptyIsHeaderOnly(t *testing.T) {
	got := EncodeItems(0x0d52, nil)
	if len(got) != headerBytes || got[4] != 0 {
		t.Fatalf("empty set should be a 6-byte header with count 0, got % x", got)
	}
}

func TestEncodeItemsCaps(t *testing.T) {
	items := make([]Item, maxAutomations+5)
	got := EncodeItems(1, items)
	if got[4] != byte(maxAutomations) {
		t.Fatalf("count should cap at %d, got %d", maxAutomations, got[4])
	}
	if len(got) != headerBytes+maxAutomations*recordBytes+maxAutomations*idBytes {
		t.Fatalf("payload should cap at %d records", maxAutomations)
	}
}

// Config version stability: the server is the ONLY hasher (the device round-trips
// the opaque version string), so there is no cross-language golden vector — just this
// Go canonical-stability test. CanonicalConfig must be deterministic regardless of
// the input map's iteration order, and ConfigVersion must be its sha256 hex. If the
// canonicalization changes, every device sees a new version and re-applies once; this
// test pins the bytes so that only ever happens on a deliberate change.
func TestCanonicalConfigStable(t *testing.T) {
	// Same logical config built two different ways — the canonical bytes must match,
	// so a re-publish of an unchanged config doesn't churn the version.
	a := CanonicalConfig(map[string]any{
		"route_0_source_min_pct": 40.0,
		"route_0_dest_max_pct":   95.0,
		"cal_low_raw":            120.0,
	})
	b := CanonicalConfig(map[string]any{
		"cal_low_raw":            120.0,
		"route_0_dest_max_pct":   95.0,
		"route_0_source_min_pct": 40.0,
	})
	if !bytes.Equal(a, b) {
		t.Fatalf("canonical bytes are order-sensitive\n a: %s\n b: %s", a, b)
	}

	// Pinned canonical form: encoding/json sorts map keys, so this is the exact body
	// the version hashes over.
	want := `{"cal_low_raw":120,"route_0_dest_max_pct":95,"route_0_source_min_pct":40}`
	if string(a) != want {
		t.Fatalf("canonical form drifted\n got: %s\nwant: %s", a, want)
	}

	// Empty/nil config canonicalizes to {} (a clear), never an empty payload.
	if e := CanonicalConfig(nil); string(e) != "{}" {
		t.Fatalf("nil config should canonicalize to {}, got %s", e)
	}

	// Version is the sha256 hex of the canonical bytes, and EncodeConfig embeds it.
	wantVer := ConfigVersion(a)
	if len(wantVer) != 64 {
		t.Fatalf("version should be 64 hex chars (sha256), got %d", len(wantVer))
	}
	if ConfigVersion(a) != ConfigVersion(b) {
		t.Fatal("version must not depend on input map order")
	}
	payload, ver := EncodeConfig(map[string]any{
		"route_0_source_min_pct": 40.0,
		"route_0_dest_max_pct":   95.0,
		"cal_low_raw":            120.0,
	})
	if ver != wantVer {
		t.Fatalf("EncodeConfig version mismatch\n got: %s\nwant: %s", ver, wantVer)
	}
	wantMsg := `{"version":"` + wantVer + `","config":` + want + `}`
	if string(payload) != wantMsg {
		t.Fatalf("config message drifted\n got: %s\nwant: %s", payload, wantMsg)
	}
}

// PublishConfigForController is the single config delivery: it reads the controller's
// desired bag from controller_config, recomputes the canonical payload + server-side
// version, stamps the version back onto the row, and publishes the retained /config
// message (QoS 1). This pins the topic, the retain/qos flags, the exact wire bytes
// (version + canonical config), and the version stamped back on the row — the shape
// the device decodes and the reconcile loop compares against.
func TestPublishConfigForControllerRetainedShape(t *testing.T) {
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

	// The dashboard writes only `desired`; the server stamps `version`. Two keys built
	// here in non-sorted order — the canonical form sorts them.
	desired := map[string]any{
		"route_0_source_min_pct": 40.0,
		"cal_low_raw":            120.0,
	}
	desiredJSON, _ := json.Marshal(desired)
	cfg := newRec("controller_config")
	cfg.Set("site", site.Id)
	cfg.Set("controller", "dev1")
	cfg.Set("desired", string(desiredJSON))
	save(cfg)

	pub := &capturePub{}
	if err := PublishConfigForController(app, pub, site.Id, "dev1"); err != nil {
		t.Fatalf("publish: %v", err)
	}

	// One retained QoS-1 publish on the controller's /config topic.
	if pub.calls != 1 {
		t.Fatalf("expected exactly one publish, got %d", pub.calls)
	}
	if want := "majiflow/" + site.Id + "/dev1/config"; pub.topic != want {
		t.Fatalf("topic mismatch\n got: %s\nwant: %s", pub.topic, want)
	}
	if !pub.retain || pub.qos != 1 {
		t.Fatalf("config must be retained QoS 1, got retain=%v qos=%d", pub.retain, pub.qos)
	}

	// The payload is byte-identical to EncodeConfig over the same bag: opaque
	// server `version` + canonical (key-sorted) config.
	wantPayload, wantVer := EncodeConfig(desired)
	if !bytes.Equal(pub.payload, wantPayload) {
		t.Fatalf("payload drifted\n got: %s\nwant: %s", pub.payload, wantPayload)
	}
	wantMsg := `{"version":"` + wantVer + `","config":{"cal_low_raw":120,"route_0_source_min_pct":40}}`
	if string(pub.payload) != wantMsg {
		t.Fatalf("payload shape drifted\n got: %s\nwant: %s", pub.payload, wantMsg)
	}

	// The freshly-computed version is stamped back on the row (server is the only
	// hasher) so the reconcile loop can compare it against the device-reported applied.
	got, err := app.FindFirstRecordByFilter("controller_config", "controller = {:c}",
		map[string]any{"c": "dev1"})
	if err != nil {
		t.Fatal(err)
	}
	if got.GetString("version") != wantVer {
		t.Fatalf("row version not stamped\n got: %s\nwant: %s", got.GetString("version"), wantVer)
	}

	// A controller with no desired-config row still publishes the empty-config message
	// (a clear), never a zero-length payload.
	pub2 := &capturePub{}
	if err := PublishConfigForController(app, pub2, site.Id, "nodev"); err != nil {
		t.Fatalf("publish (missing row): %v", err)
	}
	emptyPayload, emptyVer := EncodeConfig(nil)
	if !bytes.Equal(pub2.payload, emptyPayload) {
		t.Fatalf("missing-row payload drifted\n got: %s\nwant: %s", pub2.payload, emptyPayload)
	}
	if want := `{"version":"` + emptyVer + `","config":{}}`; string(pub2.payload) != want {
		t.Fatalf("missing-row should publish empty config\n got: %s\nwant: %s", pub2.payload, want)
	}
}
