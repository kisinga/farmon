import type { Manifest } from '@core';
import { AUTOMATION_WIRE_MAGIC, AUTOMATION_RECORD_BYTES, MAX_AUTOMATIONS } from '@core';

/**
 * Runtime automation engine — the firmware replacement for the baked schedule.
 *
 * The device holds a RAM table of automations filled from a retained MQTT message
 * (apply_automation_set, called from the mqtt on_message subscriber) and a generic
 * 5s evaluator (evaluate_automations) that fires their triggers through
 * try_route_start — so the SAME state machine still decides whether each start is
 * safe. Editing an automation is a server-side data change, no reflash.
 *
 *  - Route identity is by route_index + route_set_version: the device refuses any
 *    set whose version doesn't match its baked route table (fail-safe — an index
 *    could otherwise point at the wrong route after a topology change).
 *  - Time triggers gate on time_trusted (a real SNTP sync), never the boot
 *    estimate, and fire once per matching day-minute.
 *  - Level triggers edge-arm: fire when the route's source tank rises above the
 *    automation's OWN threshold, re-arm when it falls back below.
 *  - Each fire carries the automation's sparse run-param override (StopSpec) and a
 *    synthetic command_id so the activity timeline attributes the run to it.
 *
 * The wire layout is the single spec in [automation-wire.ts]; the struct below
 * carries a static_assert against it so the two never drift.
 */

/** C++ header — struct table, apply (memcpy + validate), generic evaluator. */
export function generateAutomationEngineHeader(m: Manifest): string {
  void m; // topology-agnostic: all routing goes through ROUTES[]/try_route_start
  return `// =============================================================================
// MajiFlow — Runtime Automation Engine (automation-engine.h)
// =============================================================================
// AUTO-GENERATED. A RAM table of automations, filled from a retained MQTT message
// and evaluated every 5s. Triggers fire through try_route_start, so the state
// machine still gates safety. Editing automations is a server data change — no
// reflash. Included after routes.h (uses ROUTES[], try_route_start, StopSpec,
// OV_* bits, get_tank_level, ROUTE_SET_VERSION).
// =============================================================================

#pragma once

#include "esphome.h"
#include <cstring>

static const uint16_t AUTOMATION_WIRE_MAGIC = 0x${AUTOMATION_WIRE_MAGIC.toString(16)};
static const int      MAX_AUTOMATIONS       = ${MAX_AUTOMATIONS};

#pragma pack(push, 1)
struct AutomationSetHeader {
  uint16_t magic_version;
  uint16_t route_set_version;
  uint8_t  count;
  uint8_t  _pad;
};
struct RuntimeAutomation {
  uint8_t  enabled;
  uint8_t  trigger_type;        // 0=time 1=level
  uint8_t  days_mask;           // bit0=MON..bit6=SUN; 0 = every day
  uint8_t  level_threshold_pct;
  uint16_t route_index;
  uint16_t time_min;            // minutes since midnight
  uint8_t  override_mask;
  uint8_t  ov_source_min_pct;
  uint8_t  ov_dest_max_pct;
  uint8_t  _pad;
  uint16_t ov_max_runtime_min;
  uint16_t ov_target_duration_s;
  uint32_t ov_target_volume_l;
};
#pragma pack(pop)
static_assert(sizeof(RuntimeAutomation) == ${AUTOMATION_RECORD_BYTES}, "RuntimeAutomation wire layout drift");

// --- Runtime table + per-automation edge state -------------------------------
// apply_automation_set (mqtt on_message) writes this table; evaluate_automations
// (5s interval) reads it. Safe without a lock ONLY because ESPHome dispatches both
// in loop() — MQTT receives are not async even with idf_send_async (only sends are).
// If that ever changes, guard g_autos/g_auto_count.
static RuntimeAutomation g_autos[MAX_AUTOMATIONS];
static uint8_t  g_auto_count = 0;
static bool     g_auto_armed[MAX_AUTOMATIONS];      // level edge-arm
static int      g_auto_last_yday[MAX_AUTOMATIONS];  // time fire-once-per-day
static uint16_t g_applied_route_set_version = 0;
static bool     g_automation_set_stale = false;     // last set refused (version mismatch)

inline void reset_automation_edges() {
  for (int i = 0; i < MAX_AUTOMATIONS; i++) { g_auto_armed[i] = true; g_auto_last_yday[i] = -1; }
}

// Fill the table from a retained binary message. Validates magic + route_set_version
// + length; on mismatch keeps the last-good set and flags stale. Empty set (count 0)
// is valid and clears the table.
inline void apply_automation_set(const uint8_t* data, size_t len) {
  if (data == nullptr || len < sizeof(AutomationSetHeader)) {
    ESP_LOGW("auto", "Automation set too small (%u bytes) — ignored", (unsigned) len);
    return;
  }
  AutomationSetHeader hdr;
  memcpy(&hdr, data, sizeof(hdr));
  if (hdr.magic_version != AUTOMATION_WIRE_MAGIC) {
    ESP_LOGW("auto", "Automation set bad magic 0x%04X — ignored", hdr.magic_version);
    return;
  }
  uint8_t count = hdr.count;
  if (count > MAX_AUTOMATIONS) count = MAX_AUTOMATIONS;
  // An empty set always clears the table, version-agnostic — a delete-to-empty
  // must take effect even if route_set_version drifted (no indices to misapply).
  if (count == 0) {
    g_auto_count = 0;
    g_applied_route_set_version = hdr.route_set_version;
    g_automation_set_stale = false;
    reset_automation_edges();
    ESP_LOGI("auto", "Automation set cleared (0 automations)");
    return;
  }
  // A non-empty set is refused unless it was authored against this route table.
  if (hdr.route_set_version != ROUTE_SET_VERSION) {
    g_automation_set_stale = true;
    ESP_LOGW("auto", "Automation set route_set_version %u != baked %u — refused, keeping last-good",
             hdr.route_set_version, ROUTE_SET_VERSION);
    return;
  }
  size_t need = sizeof(AutomationSetHeader) + (size_t) count * sizeof(RuntimeAutomation);
  if (len < need) {
    ESP_LOGW("auto", "Automation set truncated (%u < %u) — ignored", (unsigned) len, (unsigned) need);
    return;
  }
  memcpy(g_autos, data + sizeof(AutomationSetHeader), (size_t) count * sizeof(RuntimeAutomation));
  g_auto_count = count;
  g_applied_route_set_version = hdr.route_set_version;
  g_automation_set_stale = false;
  reset_automation_edges();
  ESP_LOGI("auto", "Applied %u automation(s) (route_set_version %u)", count, hdr.route_set_version);
}

// Map ESPHome ESPTime.day_of_week (1=Sun..7=Sat) to days_mask bit (bit0=MON..bit6=SUN).
inline int dow_to_bit(int dow) { return (dow == 1) ? 6 : (dow - 2); }

inline StopSpec automation_stopspec(const RuntimeAutomation& a) {
  StopSpec s;
  s.override_mask        = a.override_mask;
  s.ov_source_min_pct    = a.ov_source_min_pct;
  s.ov_dest_max_pct      = a.ov_dest_max_pct;
  s.ov_max_runtime_min   = a.ov_max_runtime_min;
  s.ov_target_duration_s = a.ov_target_duration_s;
  s.ov_target_volume_l   = a.ov_target_volume_l;
  return s;
}

// Generic evaluator — runs every 5s. Time triggers need TRUSTED time; level
// triggers read the route's source tank via get_tank_level. A fire goes through
// try_route_start (all pre-checks apply) with a synthetic command_id.
inline void evaluate_automations() {
  auto t = id(sntp_time).now();
  bool time_ok = id(time_trusted) && t.is_valid();
  int cur_min  = time_ok ? (t.hour * 60 + t.minute) : -1;
  int cur_bit  = time_ok ? dow_to_bit(t.day_of_week) : -1;
  int cur_yday = time_ok ? t.day_of_year : -1;

  for (int i = 0; i < g_auto_count; i++) {
    RuntimeAutomation& a = g_autos[i];
    if (!a.enabled) continue;
    int rid = a.route_index;
    if (rid < 0 || rid >= NUM_ROUTES) continue;

    if (a.trigger_type == 0) {            // TIME
      if (!time_ok) continue;
      bool day_ok = (a.days_mask == 0) || (a.days_mask & (1 << cur_bit));
      if (day_ok && cur_min == (int) a.time_min && g_auto_last_yday[i] != cur_yday) {
        g_auto_last_yday[i] = cur_yday;   // fire once for this day-minute
        char cmd[24];
        snprintf(cmd, sizeof(cmd), "auto%d_%u", i, (unsigned) t.timestamp);
        int rc = try_route_start(rid, cmd, automation_stopspec(a));
        ESP_LOGI("auto", "Time automation %d -> route %d rc=%d", i, rid, rc);
      }
    } else {                              // LEVEL
      float lvl = get_tank_level(ROUTES[rid].source_tank);
      if (std::isnan(lvl) || lvl < 0.0f) continue;   // no level source
      if (lvl > (float) a.level_threshold_pct) {
        if (g_auto_armed[i]) {
          char cmd[24];
          snprintf(cmd, sizeof(cmd), "auto%d_%u", i, (unsigned) millis());
          int rc = try_route_start(rid, cmd, automation_stopspec(a));
          ESP_LOGI("auto", "Level automation %d (%.0f%% > %u%%) -> route %d rc=%d",
                   i, lvl, a.level_threshold_pct, rid, rc);
        }
        g_auto_armed[i] = false;
      } else {
        g_auto_armed[i] = true;
      }
    }
  }
}
`;
}

/** YAML package — the 5s evaluator interval. Table + statics live in the header;
 *  the mqtt on_message subscriber (mqtt.yaml) fills it via apply_automation_set. */
export function generateAutomationEngineYaml(): string {
  return `# =============================================================================
# MajiFlow — Runtime Automation Engine
# =============================================================================
# AUTO-GENERATED. The automation table + apply/evaluate logic live in
# automation-engine.h. This package runs the generic evaluator every 5s; the set
# is delivered as a retained binary on the config topic (see mqtt.yaml on_message).
# =============================================================================

interval:
  - interval: 5s
    then:
      - lambda: 'evaluate_automations();'
`;
}
