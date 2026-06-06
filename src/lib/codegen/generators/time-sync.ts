import type { GenerationMetadata } from '../backends/types';

/**
 * Persisted wall clock + time-trust flag — keeps time without an RTC chip.
 *
 * The ESP32's on-SoC clock is lost on power-loss and SNTP needs the network, so a
 * device that cold-boots offline has no time until the link returns. Two pieces:
 *
 *   - `persisted_epoch` (flash) — refreshed every few minutes while time is trusted,
 *     and used to SEED the system clock on boot so `now()` is plausible (for logs /
 *     OLED / event timestamps). Bounded error = downtime; SNTP corrects on reconnect.
 *   - `time_trusted` (RAM, re-earned each boot) — true ONLY after a real SNTP sync.
 *     The seed makes the system clock "valid" off an estimate, so anything that needs
 *     CORRECT time (schedules, the command-TTL gate) gates on `time_trusted`, never on
 *     `is_valid()`. The estimate is for display, never for decisions.
 *
 * Emitted on every device:
 *   - time-sync.h    — `seed_clock_from_persisted()` (sanity-bounded), called on_boot.
 *   - time-sync.yaml — the `persisted_epoch` + `time_trusted` globals + the refresh.
 *
 * `time_trusted` is SET by the `on_time_sync` trigger on `sntp_time`, which lives with
 * the sntp definition (schedule.yaml when there are time schedules, else mqtt.yaml).
 */

/** Refresh cadence for the persisted epoch. On ESP32 this lands in wear-leveled NVS,
 *  and since schedules wait for TRUSTED (SNTP) time the persisted value is only a
 *  cosmetic boot estimate — its freshness doesn't affect correctness, so we write
 *  infrequently. ~48 writes/day → NVS coalesces ~100+ small writes per page erase, far
 *  under the ~100k-erase endurance over any device lifetime. */
const REFRESH = '30min';
/** Sanity ceiling above the build time — a persisted epoch beyond this is corrupt flash. */
const TWENTY_YEARS_S = 631152000;

/** C++ header: seed the system clock from the flash-persisted epoch on boot. */
export function generateTimeSyncHeader(metadata: GenerationMetadata): string {
  const floor = metadata.buildTimestamp;
  const ceil = metadata.buildTimestamp + TWENTY_YEARS_S;
  return `// =============================================================================
// MajiFlow — Persisted Clock (time-sync.h)
// =============================================================================
// Seeds the wall clock from a flash-persisted epoch on boot so a device that
// cold-boots offline resumes a plausible time until SNTP re-syncs. No RTC.
// The seed is an ESTIMATE: it does NOT set time_trusted, so it never drives a
// schedule or the TTL gate (those wait for a real SNTP sync).
// =============================================================================

#include <sys/time.h>

// Seed the wall clock from the persisted epoch, rejecting garbage: the clock cannot
// predate the firmware build, and a value far in the future means corrupt flash.
inline void seed_clock_from_persisted() {
  int64_t e = id(persisted_epoch);
  if (e < ${floor}LL || e > ${ceil}LL) return;
  struct timeval tv;
  tv.tv_sec = (time_t) e;
  tv.tv_usec = 0;
  settimeofday(&tv, nullptr);
  ESP_LOGI("time", "Clock seeded from flash (%lld) — estimate, not trusted", (long long) e);
}
`;
}

/** YAML package: persisted epoch + trust flag + the (trusted-only) refresh interval. */
export function generateTimeSync(): string {
  return `# =============================================================================
# MajiFlow — Persisted Clock (time-sync)
# =============================================================================
# AUTO-GENERATED. Flash-persisted wall clock + trust flag, no RTC. on_boot seeds the
# clock from persisted_epoch (see time-sync.h); this interval refreshes it only while
# time is TRUSTED (real SNTP), so the estimate never feeds itself. time_trusted is set
# by sntp_time's on_time_sync (in schedule.yaml or mqtt.yaml).
# =============================================================================

globals:
  - id: persisted_epoch
    type: int64_t
    restore_value: yes
    initial_value: '0'
  - id: time_trusted
    type: bool
    restore_value: no
    initial_value: 'false'

interval:
  - interval: ${REFRESH}
    then:
      - lambda: |-
          if (id(time_trusted)) id(persisted_epoch) = (int64_t) id(sntp_time).now().timestamp;
`;
}
