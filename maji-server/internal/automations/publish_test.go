package automations

import (
	"bytes"
	"testing"
)

// Cross-language drift guard: the Go encoder must produce the same bytes as the
// TS reference encoder (src/lib/automation-wire.ts). This golden vector is the
// identical case asserted in test/automation-wire.test.ts.
func TestEncodeItemsGoldenVector(t *testing.T) {
	item := Item{
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
		0b10001,    // override_mask
		20,         // ov_source_min_pct
		95,         // ov_dest_max_pct
		0x00,       // pad
		45, 0x00, // ov_max_runtime_min 45 LE
		0x08, 0x07, // ov_target_duration_s 1800 LE
		0xf4, 0x01, 0x00, 0x00, // ov_target_volume_l 500 LE
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
	if len(got) != headerBytes+maxAutomations*recordBytes {
		t.Fatalf("payload should cap at %d records", maxAutomations)
	}
}
