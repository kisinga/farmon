// Host tests for the pure billing meter kernel (firmware/components/maji_control/meter.cpp).
// Characterizes the durable litre counter (reset-aware, remainder-carrying), run identity,
// the run records, the bounded outbox, the ack high-water-mark, and runs[] serialization —
// the billing-critical logic, lifted out of the shell so it is provably correct.
//
//   bash firmware/test/run-host-tests.sh
#include "meter.h"
#include <cstdio>
#include <cstring>

using namespace maji_meter;

static int pass = 0, fail = 0;
static void check(bool c, const char *name) {
  if (c) { printf("  ok   %s\n", name); pass++; }
  else { printf("  FAIL %s\n", name); fail++; }
}

// --- Counter: reset-aware accumulation, sub-litre remainder carry ---
static void test_counter() {
  MeterState m;
  m.init(1, 2);
  const uint32_t CAL = 450;  // pulses/L
  on_reading(m, 0, 0, CAL);    // seed (baseline the pre-boot total away)
  check(litres(m, 0) == 0, "counter: seeds at 0");
  on_reading(m, 0, 450, CAL);
  check(litres(m, 0) == 1, "counter: 450 pulses = 1 L");
  on_reading(m, 0, 675, CAL);  // +225 pulses: half a litre, carried
  check(litres(m, 0) == 1, "counter: remainder not yet a litre");
  on_reading(m, 0, 900, CAL);  // +225 pulses: remainder completes the 2nd litre
  check(litres(m, 0) == 2, "counter: carried remainder completes a litre (no rounding loss)");
  on_reading(m, 0, 100, CAL);  // raw dropped: reboot -> re-baseline, never count backwards
  check(litres(m, 0) == 2, "counter: a pulse-total reset does not lose litres");
  on_reading(m, 0, 550, CAL);  // +450 from the new baseline
  check(litres(m, 0) == 3, "counter: resumes after reset");
}

// --- Run identity: epoch gate + monotonic seq + start-litres capture ---
static void test_open() {
  MeterState m;
  m.init(1, 2);
  bool ok = open_run(m, 0, 0, 0, "MANUAL", "u1", 1000, 5000);
  check(!ok, "open: refused before the lineage epoch is stamped (unbillable)");

  stamp_epoch(m, 1700000000u);
  on_reading(m, 0, 0, 450);
  on_reading(m, 0, 900, 450);  // 2 L on the clock
  ok = open_run(m, 0, 0, 0, "MANUAL", "u1", 1700000001u, 5000);
  check(ok && m.run_seq == 1, "open: mints seq 1 once stamped");
  check(m.open[0].epoch == 1700000000u && m.open[0].start_litres == 2, "open: captures epoch + start_litres");

  open_run(m, 1, 1, -1, "AUTOMATION", "a1", 1700000002u, 6000);
  check(m.run_seq == 2, "open: seq is monotonic across slots");

  stamp_epoch(m, 9999u);  // already stamped -> no-op (lineage stays stable across reboots)
  check(m.run_epoch == 1700000000u, "stamp_epoch: idempotent once set");
}

// --- Close: delivered (end-start) + monotonic duration; metered vs time-only ---
static void test_close() {
  MeterState m;
  m.init(1, 2);
  stamp_epoch(m, 1700000000u);
  on_reading(m, 0, 0, 450);
  on_reading(m, 0, 45000, 450);  // 100 L
  open_run(m, 0, 0, 0, "MANUAL", "u1", 1700000001u, 5000);
  on_reading(m, 0, 90000, 450);  // 200 L (100 delivered this run)
  close_run(m, 0, "VOLUME_REACHED", "", 1700000301u, 305000);
  check(m.outbox.size() == 1, "close: enqueues one record");
  const RunRecord &r = m.outbox[0];
  check(r.metered && (r.end_litres - r.start_litres) == 100, "close: metered delivered = end - start");
  check(r.duration_s == 300, "close: duration from the monotonic timer (305000-5000)/1000");
  check(r.stop_reason == "VOLUME_REACHED" && r.epoch == 1700000000u && r.seq == 1, "close: carries token + run_id");

  // Unmetered route (no flow sensor): time-billable, no litres.
  open_run(m, 1, 1, -1, "MANUAL", "u1", 1700000400u, 400000);
  close_run(m, 1, "DURATION_REACHED", "", 1700000700u, 700000);
  const RunRecord &u = m.outbox[1];
  check(!u.metered && u.start_litres == 0 && u.end_litres == 0, "close: unmetered run carries no litres");
  check(u.duration_s == 300, "close: unmetered run still carries duration");

  // close with no open run on a slot is a no-op (e.g. PREPARING->IDLE never ran).
  close_run(m, 0, "MANUAL", "", 1700000800u, 800000);
  check(m.outbox.size() == 2, "close: no-op when nothing is open");
}

// --- Ack high-water-mark drops confirmed records, keeps the rest ---
static void test_ack() {
  MeterState m;
  m.init(1, 4);
  stamp_epoch(m, 1700000000u);
  for (int i = 0; i < 3; i++) {  // seq 1,2,3
    open_run(m, 0, 0, -1, "MANUAL", "u", 1700000000u, 1000);
    close_run(m, 0, "MANUAL", "", 1700000000u, 2000);
  }
  check(m.outbox.size() == 3, "ack: three runs queued");
  on_ack(m, 1700000000u, 2);  // confirm up to seq 2
  check(m.outbox.size() == 1 && m.outbox[0].seq == 3, "ack: drops <= high-water, keeps seq 3");
  on_ack(m, 1700000000u, 1);  // stale ack -> no-op
  check(m.outbox.size() == 1, "ack: a stale high-water never resurrects/drops");
}

// --- Outbox overflow: bounded, drops oldest, counts the loss ---
static void test_overflow() {
  MeterState m;
  m.init(1, 1);
  stamp_epoch(m, 1700000000u);
  for (int i = 0; i < OUTBOX_CAP + 5; i++) {
    open_run(m, 0, 0, -1, "MANUAL", "u", 1700000000u, 1000);
    close_run(m, 0, "MANUAL", "", 1700000000u, 2000);
  }
  check((int) m.outbox.size() == OUTBOX_CAP, "overflow: outbox stays bounded at OUTBOX_CAP");
  check(m.dropped == 5, "overflow: drops are counted (a loud fault signal)");
  check(m.outbox.front().seq == 6, "overflow: drops the oldest, keeps the newest");
}

// --- Live progress + JSON serialization ---
static void test_serialize() {
  MeterState m;
  m.init(1, 2);
  stamp_epoch(m, 1700000000u);
  on_reading(m, 0, 0, 450);
  on_reading(m, 0, 22500, 450);  // 50 L
  open_run(m, 0, 0, 0, "MANUAL", "jane", 1700000001u, 5000);
  on_reading(m, 0, 33750, 450);  // 75 L (25 delivered live)
  check(open_delivered(m, 0) == 25, "progress: open_delivered = now - start");
  close_run(m, 0, "VOLUME_REACHED", "", 1700000301u, 35000);

  char buf[512];
  int n = serialize_runs(m, buf, sizeof(buf));
  check(n > 0 && (int) strlen(buf) == n, "serialize: returns the written length");
  check(strstr(buf, "\"run_id\":\"1700000000:1\"") != nullptr, "serialize: run_id = epoch:seq");
  check(strstr(buf, "\"start_litres\":50,\"end_litres\":75") != nullptr, "serialize: litre boundaries");
  check(strstr(buf, "\"metered\":true") != nullptr, "serialize: metered flag");
  check(strstr(buf, "\"stop_reason\":\"VOLUME_REACHED\"") != nullptr, "serialize: stop-reason token");
  check(strstr(buf, "\"duration_s\":30") != nullptr, "serialize: duration");
  check(strstr(buf, "\"origin\":\"MANUAL\"") != nullptr && strstr(buf, "\"actor\":\"jane\"") != nullptr,
        "serialize: attribution");
}

int main() {
  printf("meter kernel\n");
  test_counter();
  test_open();
  test_close();
  test_ack();
  test_overflow();
  test_serialize();
  printf("\n%d passed, %d failed\n", pass, fail);
  return fail ? 1 : 0;
}
