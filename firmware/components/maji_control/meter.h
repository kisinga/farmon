#pragma once
// Billing meter kernel — PURE C++ (no esphome, no id(), no millis()), a sibling of the
// control kernel (core.{h,cpp}). It owns the durable litre counter, run identity, the
// per-run records, and the outbox the shell re-asserts in the snapshot `runs[]` array.
//
// It is DRIVEN by the control kernel's slot transitions: the shell observes a slot go
// PREPARING->RUNNING (open_run) and ->IDLE/FAULT (close_run) and calls in. All I/O lives
// in the shell: it persists MeterState to flash (ESPPreference), feeds a flow reading
// (on_reading — source-agnostic: a local pulse count, a smart sensor's onboard totalizer
// over RS485/Modbus, an ultrasonic meter, or a shell-integrated rate), supplies trusted
// time (stamp_epoch) and the int->token mapping for origin/stop_reason/fault (this kernel
// stays token-agnostic), and consumes the retained runs_ack high-water-mark (on_ack).
// Host-testable like core.{h,cpp}.
#include <cstdint>
#include <string>
#include <vector>

namespace maji_meter {

// Bounded durable outbox. Overflow (a multi-day server outage with many runs) drops the
// oldest and bumps `dropped` so the shell can raise a loud fault; the durable cumulative
// counter still captures the period volume, so only per-run attribution is lost.
static constexpr int OUTBOX_CAP = 32;

// A closed run awaiting server acknowledgement. run_id = (epoch, seq): unique per device
// forever (epoch is a stable lineage stamp; seq is monotonic within a lineage).
struct RunRecord {
  uint32_t epoch{0};
  uint32_t seq{0};
  int route{-1};
  std::string origin;       // wire token, supplied by the shell (e.g. "MANUAL")
  std::string actor;        // user / automation id bound to the run
  uint32_t start_epoch{0};  // wall-clock secs at open (best-effort; 0 if untrusted)
  uint32_t end_epoch{0};    // wall-clock secs at close (best-effort)
  uint32_t duration_s{0};   // from the monotonic run timer (exact)
  std::string stop_reason;  // wire token, supplied by the shell
  std::string fault;        // wire token ("" = clean)
  uint64_t start_litres{0};
  uint64_t end_litres{0};
  bool metered{false};      // false => unmetered route: time-billable only
};

// The currently-open run on a control slot (water flowing). Durable so a mid-run reboot
// can close it as interrupted on boot.
struct OpenRun {
  bool active{false};
  uint32_t epoch{0};
  uint32_t seq{0};
  int route{-1};
  int flow_sensor{-1};  // -1 = unmetered
  std::string origin;
  std::string actor;
  uint32_t start_epoch{0};
  uint32_t run_start_ms{0};
  uint64_t start_litres{0};
};

// Per-flow-sensor durable accumulation, source-agnostic. `last_raw` is the last
// cumulative reading from whatever source (local pulse count, sensor onboard totalizer,
// integrated rate); on_reading re-baselines on a drop, carrying the sub-litre remainder
// so the cumulative litres never drift (1 L resolution, no per-run rounding loss). The
// whole struct is durable (shell persists it), so an external totalizer that survives a
// controller reboot is captured with no loss.
struct Counter {
  uint64_t litres{0};
  uint32_t remainder{0};  // sub-litre carry, in raw source units
  uint32_t last_raw{0};   // last cumulative reading (delta + reset detection)
  bool seeded{false};
};

// All meter state. The shell persists the durable parts (counters, run_epoch/seq, open,
// outbox, acked_*) to flash; last_pulse_total re-seeds from the hardware on boot.
struct MeterState {
  uint32_t run_epoch{0};  // stable lineage stamp (0 = unstamped, can't mint yet)
  uint32_t run_seq{0};    // monotonic within a lineage
  std::vector<Counter> counters;  // per flow sensor
  std::vector<OpenRun> open;      // per control slot
  std::vector<RunRecord> outbox;  // FIFO, <= OUTBOX_CAP
  uint32_t acked_epoch{0};
  uint32_t acked_seq{0};
  uint32_t dropped{0};    // outbox-overflow count (a loud fault signal for the shell)

  void init(int num_flow_sensors, int num_slots);
};

// Stamp the lineage epoch once from trusted wall-clock. No-op if already stamped or
// trusted_epoch == 0. The epoch only moves forward, so a post-NVS-wipe device gets a
// LATER epoch and its run_ids never collide with the prior lineage's.
void stamp_epoch(MeterState &m, uint32_t trusted_epoch);

// Reset-aware litre accumulation from ANY monotonic cumulative source: a local pulse
// count, a smart sensor's onboard totalizer (RS485/Modbus/ultrasonic), or a shell-
// integrated rate. `units_per_litre` converts the raw unit to litres (pulses/L for a
// pulse counter; 1 for a litre totalizer; 10 for deci-litres — for coarser units like
// m3 the shell pre-scales to litres). A DROP in raw_cumulative (a counter/sensor reset
// or rollover) re-baselines without counting backwards. Because last_raw is durable,
// an external totalizer that keeps counting across a controller reboot loses nothing; a
// local counter that zeroes on reboot loses only the unread sub-sample.
void on_reading(MeterState &m, int sensor, uint32_t raw_cumulative, uint32_t units_per_litre);

// Cumulative litres for a sensor (live progress / boundary capture). 0 if out of range.
uint64_t litres(const MeterState &m, int sensor);

// Open a run on a slot (PREPARING->RUNNING). Mints run_id, captures start_litres from the
// durable counter. flow_sensor < 0 = unmetered. Returns false (no run minted) if the
// lineage epoch is unstamped (time never trusted) — an un-timestampable run is unbillable.
bool open_run(MeterState &m, int slot, int route, int flow_sensor, const std::string &origin,
              const std::string &actor, uint32_t start_epoch, uint32_t run_start_ms);

// Delivered litres of a slot's open run so far (live progress). -1 if none/unmetered.
int64_t open_delivered(const MeterState &m, int slot);

// Close a slot's open run (-> IDLE / FAULT / boot-interrupt). No-op if none open. Computes
// delivered (end - start) and duration (from the monotonic run timer) and enqueues to the
// outbox (dropping the oldest + bumping `dropped` on overflow). The shell supplies the
// stop_reason / fault tokens (e.g. "INTERRUPTED" for a boot-closed run).
void close_run(MeterState &m, int slot, const std::string &stop_reason, const std::string &fault,
               uint32_t end_epoch, uint32_t now_ms);

// Advance the ack high-water-mark and drop every confirmed outbox entry (<= epoch:seq).
void on_ack(MeterState &m, uint32_t epoch, uint32_t seq);

// Serialize the outbox as the snapshot `runs[]` array BODY (objects comma-joined, no
// enclosing []). The shell wraps it: "runs":[<body>]. Returns bytes written (< cap).
int serialize_runs(const MeterState &m, char *buf, int cap);

}  // namespace maji_meter
