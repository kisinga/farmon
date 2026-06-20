// Host test for the pure automation kernel (firmware/components/maji_automations/core.cpp).
// Proves the retained-set validation (magic / version-gate / length / empty-clears) and
// the trigger decision (time fire-once-per-day, day-mask, level edge arm/disarm). No
// esphome / maji_control needed — the kernel is plain data in / decision out.
//
//   bash firmware/test/run-host-tests.sh
#include "core.h"
#include <cmath>
#include <cstdio>
#include <cstring>

using namespace maji_auto;

static int pass = 0, fail = 0;
static void check(bool c, const char *name) {
  if (c) { printf("  ok   %s\n", name); pass++; }
  else { printf("  FAIL %s\n", name); fail++; }
}

// Build a one-record set: header(6) + record(20) + id(16). `ver` is the route_set_version.
static size_t build_set(uint8_t *buf, uint16_t ver, const RuntimeAutomation &a, const char *id) {
  memset(buf, 0, AUTOMATION_HEADER_BYTES + AUTOMATION_RECORD_BYTES + AUTOMATION_ID_BYTES);
  buf[0] = AUTOMATION_WIRE_MAGIC & 0xFF;
  buf[1] = (AUTOMATION_WIRE_MAGIC >> 8) & 0xFF;
  buf[2] = ver & 0xFF;
  buf[3] = (ver >> 8) & 0xFF;
  buf[4] = 1;  // count
  memcpy(buf + AUTOMATION_HEADER_BYTES, &a, AUTOMATION_RECORD_BYTES);
  size_t ids_off = AUTOMATION_HEADER_BYTES + AUTOMATION_RECORD_BYTES;
  size_t idn = strlen(id);
  if (idn > (size_t) (AUTOMATION_ID_BYTES - 1)) idn = AUTOMATION_ID_BYTES - 1;
  memcpy((char *) buf + ids_off, id, idn);  // buf is memset 0, so the field stays nul-padded
  return AUTOMATION_HEADER_BYTES + AUTOMATION_RECORD_BYTES + AUTOMATION_ID_BYTES;
}

int main() {
  const uint16_t VER = 0x0d52;
  RuntimeAutomation table[MAX_AUTOMATIONS];
  char ids[MAX_AUTOMATIONS][AUTOMATION_ID_BYTES];
  uint8_t count = 7;  // sentinel — must be overwritten only on a write path

  // --- struct layout pinned (drift guard mirror) ---
  check(sizeof(RuntimeAutomation) == 20, "RuntimeAutomation is 20 bytes");
  check(AUTOMATION_WIRE_MAGIC == 0xa001 && AUTOMATION_ID_BYTES == 16 && MAX_AUTOMATIONS == 32,
        "protocol constants match the SSOT");

  // --- apply_set: a good set loads ---
  RuntimeAutomation a;
  memset(&a, 0, sizeof(a));
  a.enabled = 1; a.trigger_type = 0; a.days_mask = 0b0101010; a.route_index = 3;
  a.time_min = 6 * 60 + 30; a.override_mask = 0b10001; a.ov_target_volume_l = 500;
  uint8_t buf[64];
  size_t n = build_set(buf, VER, a, "abc123def456ghi");
  check(apply_set(buf, n, VER, table, ids, count) == APPLY_OK, "good set -> APPLY_OK");
  check(count == 1, "good set -> count 1");
  check(table[0].route_index == 3 && table[0].time_min == 390 && table[0].ov_target_volume_l == 500,
        "record fields round-trip");
  check(strcmp(ids[0], "abc123def456ghi") == 0, "trailing id round-trips");

  // --- bad magic: keep last-good ---
  count = 9; uint8_t bad[64]; memcpy(bad, buf, n); bad[1] = 0xFF;  // corrupt magic high byte
  check(apply_set(bad, n, VER, table, ids, count) == APPLY_BAD_MAGIC, "bad magic -> APPLY_BAD_MAGIC");
  check(count == 9, "bad magic leaves count untouched (keep last-good)");

  // --- version mismatch on a non-empty set: refused, keep last-good ---
  count = 9;
  check(apply_set(buf, n, VER + 1, table, ids, count) == APPLY_VERSION_REFUSED, "version mismatch -> refused");
  check(count == 9, "version-refused leaves count untouched");

  // --- empty set clears, version-agnostic ---
  uint8_t empty[AUTOMATION_HEADER_BYTES] = {0};
  empty[0] = AUTOMATION_WIRE_MAGIC & 0xFF; empty[1] = (AUTOMATION_WIRE_MAGIC >> 8) & 0xFF;
  empty[2] = 0xEE; empty[3] = 0xFF;  // deliberately WRONG version
  empty[4] = 0;                      // count 0
  count = 9;
  check(apply_set(empty, sizeof(empty), VER, table, ids, count) == APPLY_CLEARED, "empty set -> APPLY_CLEARED");
  check(count == 0, "empty set clears the table regardless of version");

  // --- truncated (count says 1 but no record bytes) ---
  uint8_t trunc[AUTOMATION_HEADER_BYTES] = {0};
  trunc[0] = AUTOMATION_WIRE_MAGIC & 0xFF; trunc[1] = (AUTOMATION_WIRE_MAGIC >> 8) & 0xFF;
  trunc[2] = VER & 0xFF; trunc[3] = (VER >> 8) & 0xFF; trunc[4] = 1;
  count = 9;
  check(apply_set(trunc, sizeof(trunc), VER, table, ids, count) == APPLY_TRUNCATED, "truncated -> APPLY_TRUNCATED");
  check(count == 9, "truncated leaves count untouched");

  // --- too small (shorter than the header) ---
  check(apply_set(buf, 3, VER, table, ids, count) == APPLY_TOO_SMALL, "too-small -> APPLY_TOO_SMALL");
  check(apply_set(nullptr, 0, VER, table, ids, count) == APPLY_TOO_SMALL, "null -> APPLY_TOO_SMALL");

  // --- should_fire: TIME, fire once per matching day-minute ---
  RuntimeAutomation t;
  memset(&t, 0, sizeof(t));
  t.enabled = 1; t.trigger_type = 0; t.days_mask = 0; t.time_min = 390;  // 06:30, every day
  EdgeState edge;  // fresh: armed, last_yday -1
  TimeInputs ti; ti.time_ok = true; ti.cur_min = 390; ti.cur_bit = 2; ti.cur_yday = 100;
  check(should_fire(t, ti, NAN, edge), "time trigger fires at the matching minute");
  check(!should_fire(t, ti, NAN, edge), "time trigger does not re-fire the same day-minute");
  ti.cur_min = 391;
  check(!should_fire(t, ti, NAN, edge), "time trigger silent off-minute");
  ti.cur_min = 390; ti.cur_yday = 101;
  check(should_fire(t, ti, NAN, edge), "time trigger fires again the next day");

  // time trigger needs trusted time
  EdgeState e2; TimeInputs untrusted; untrusted.time_ok = false;
  check(!should_fire(t, untrusted, NAN, e2), "time trigger silent without trusted time");

  // day-mask gating: Mon,Wed,Fri only (bits 0,2,4)
  RuntimeAutomation td = t; td.days_mask = 0b0010101;
  EdgeState e3; TimeInputs tue; tue.time_ok = true; tue.cur_min = 390; tue.cur_bit = 1; tue.cur_yday = 5;
  check(!should_fire(td, tue, NAN, e3), "day-mask blocks a non-matching day");
  TimeInputs wed; wed.time_ok = true; wed.cur_min = 390; wed.cur_bit = 2; wed.cur_yday = 6;
  check(should_fire(td, wed, NAN, e3), "day-mask allows a matching day");

  // --- should_fire: LEVEL, edge arm/disarm ---
  RuntimeAutomation lv;
  memset(&lv, 0, sizeof(lv));
  lv.enabled = 1; lv.trigger_type = 1; lv.level_threshold_pct = 80;
  EdgeState le; TimeInputs nt;  // time irrelevant for level
  check(should_fire(lv, nt, 85.0f, le), "level trigger fires on rising edge above threshold");
  check(!should_fire(lv, nt, 90.0f, le), "level trigger stays disarmed while above threshold");
  check(!should_fire(lv, nt, 50.0f, le), "level trigger re-arms below threshold (no fire)");
  check(should_fire(lv, nt, 85.0f, le), "level trigger fires again after re-arming");
  check(!should_fire(lv, nt, NAN, le), "level trigger silent with no source (NaN)");

  // disabled never fires
  RuntimeAutomation off = t; off.enabled = 0; EdgeState e4;
  check(!should_fire(off, ti, NAN, e4), "disabled automation never fires");

  printf("\n%d passed, %d failed\n", pass, fail);
  return fail ? 1 : 0;
}
