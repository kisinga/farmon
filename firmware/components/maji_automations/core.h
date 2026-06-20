#pragma once
// Runtime automation engine kernel — PURE C++ (no esphome, no id(), no millis()).
// The packed wire struct, the retained-set validation (magic / route_set_version /
// length gates), and the per-automation trigger decision (time fire-once-per-day,
// level edge arm/disarm) as plain data in / decision out. The shell (maji_automations)
// fills time + tank level from id(...) and applies a fire by calling the control engine.
//
// Wire layout is the single spec in src/lib/automation-wire.ts; the struct here carries
// a static_assert against AUTOMATION_RECORD_BYTES and test/automation-wire.test.ts pins
// the constants + field order against the TS source so the two never drift.
#include <cstdint>
#include <cstddef>

namespace maji_auto {

// Protocol constants — must match the @core SSOT (src/lib/automation-wire.ts).
static constexpr uint16_t AUTOMATION_WIRE_MAGIC = 0xa001;
static constexpr int AUTOMATION_HEADER_BYTES = 6;
static constexpr int AUTOMATION_RECORD_BYTES = 20;
static constexpr int AUTOMATION_ID_BYTES = 16;
static constexpr int MAX_AUTOMATIONS = 32;

#pragma pack(push, 1)
struct AutomationSetHeader {
  uint16_t magic_version;
  uint16_t route_set_version;
  uint8_t count;
  uint8_t _pad;
};
struct RuntimeAutomation {
  uint8_t enabled;
  uint8_t trigger_type;       // 0=time 1=level
  uint8_t days_mask;          // bit0=MON..bit6=SUN; 0 = every day
  uint8_t level_threshold_pct;
  uint16_t route_index;
  uint16_t time_min;          // minutes since midnight
  uint8_t override_mask;
  uint8_t ov_source_min_pct;
  uint8_t ov_dest_max_pct;
  uint8_t _pad;
  uint16_t ov_max_runtime_min;
  uint16_t ov_target_duration_s;
  uint32_t ov_target_volume_l;
};
#pragma pack(pop)
static_assert(sizeof(RuntimeAutomation) == AUTOMATION_RECORD_BYTES, "RuntimeAutomation wire layout drift");

// Outcome of validating + loading a retained set. On any code that keeps the last-good
// table (BAD_MAGIC / VERSION_REFUSED / TRUNCATED / TOO_SMALL), the destination is left
// untouched; only OK (new table) and CLEARED (count 0) write.
enum ApplyResult {
  APPLY_OK = 0,           // table replaced with `count` records
  APPLY_CLEARED,          // empty set — table cleared (version-agnostic)
  APPLY_TOO_SMALL,        // shorter than the header
  APPLY_BAD_MAGIC,        // wrong magic
  APPLY_VERSION_REFUSED,  // non-empty set authored against a different route table
  APPLY_TRUNCATED,        // header count exceeds the bytes present
};

// Per-automation edge state, owned by the shell and passed in/out of should_fire:
//   armed     — level trigger re-arm latch (fire on rising edge above threshold)
//   last_yday — day-of-year of the last time fire (fire once per matching day-minute)
struct EdgeState {
  bool armed{true};
  int last_yday{-1};
};

// The wall-clock inputs a time trigger needs, filled by the shell from SNTP.
struct TimeInputs {
  bool time_ok{false};  // a TRUSTED sync, not the boot estimate
  int cur_min{-1};      // minutes since midnight
  int cur_bit{-1};      // days_mask bit for today (bit0=MON..bit6=SUN)
  int cur_yday{-1};     // day of year
};

// Validate a retained binary set and load it into `table`/`ids`/`count`. `baked` is the
// device's own ROUTE_SET_VERSION (config-injected). See ApplyResult for the keep-vs-write
// semantics; logging is the shell's job (this is pure).
ApplyResult apply_set(const uint8_t *data, size_t len, uint16_t baked, RuntimeAutomation *table,
                      char ids[][AUTOMATION_ID_BYTES], uint8_t &count);

// Map ESPHome ESPTime.day_of_week (1=Sun..7=Sat) to a days_mask bit (bit0=MON..bit6=SUN).
int dow_to_bit(int dow);

// Decide whether automation `a` fires this tick, mutating `edge` for time fire-once /
// level arm-disarm. `level` is the route source-tank % (only read for level triggers;
// pass <0 / NaN when there is no source). Returns true to start the route.
bool should_fire(const RuntimeAutomation &a, const TimeInputs &t, float level, EdgeState &edge);

}  // namespace maji_auto
