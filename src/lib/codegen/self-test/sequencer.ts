/**
 * Composes C++ self-test header from active probes.
 *
 * The framework provides: namespace, phase enum, state machine plumbing
 * (record, next_phase, update_ha, tick dispatcher, init, start).
 * Each probe contributes: constants, state, helpers, tick function body.
 */

import type { BoardDef } from '@core';
import type { TestProbe } from './probe';

export function generateSequencer(board: BoardDef, probes: TestProbe[]): string {
  const phaseEnum = ['IDLE', ...probes.map(p => p.id.toUpperCase()), 'DONE'].join(', ');
  const totalTests = probes.length;

  // Collect phase name cases
  const phaseNameCases = probes.map(p =>
    `    case ${p.id.toUpperCase()}: return "${p.label}";`
  ).join('\n');

  // Collect contributions from each probe
  const constantsBlock = probes
    .map(p => p.constants(board))
    .filter(Boolean)
    .join('\n  ');

  const stateBlock = probes
    .map(p => p.state())
    .filter(Boolean)
    .join('\n  ');

  const helpersBlock = probes
    .map(p => p.helpers(board))
    .filter(Boolean)
    .join('\n');

  // Generate tick functions — one per probe
  const tickFunctions = probes.map(p => {
    const funcName = `tick_${p.id}`;
    const body = p.tick(board);
    return `  void ${funcName}() {${body}
  }`;
  }).join('\n\n');

  // Generate tick dispatcher
  const dispatchCases = probes.map(p =>
    `    case ${p.id.toUpperCase()}: tick_${p.id}(); break;`
  ).join('\n');

  // WiFi scan needs esp_wifi.h
  const needsWifi = probes.some(p => p.id === 'wifi_scan');

  return `\
// =============================================================================
// ${board.label} — Self-Test Sequencer
// =============================================================================
// AUTO-GENERATED from board definition + ${probes.length} active probes.
// Non-blocking state machine driven by ESPHome interval (100ms tick).
// =============================================================================

#pragma once
#include "esphome.h"
#include "driver/gpio.h"
${needsWifi ? '#include "esp_wifi.h"\n' : ''}\

namespace selftest {

  enum Phase { ${phaseEnum} };

  // --- Board constants (from probes) ---
  ${constantsBlock}
  static const int TOTAL_TESTS = ${totalTests};

  // --- State ---
  static Phase phase = IDLE;
  static int sub_step = 0;
  static uint32_t step_timer = 0;
  static uint32_t phase_start = 0;
  static int tests_done = 0;
  static bool all_passed = true;
  static char log_buf[512];
  static int log_len = 0;
  static bool auto_start_pending = true;
  static Phase last_published_phase = IDLE;
  static int last_published_tests = -1;
  ${stateBlock}

  // --- Phase name ---
  const char* phase_name(Phase p) {
    switch (p) {
    case IDLE: return "Idle";
${phaseNameCases}
    case DONE: return "Done";
    default: return "Unknown";
    }
  }

  // Forward declarations
  void start();

  // --- I2C helpers using ESPHome's I2C bus component (id: i2c_bus) ---
  bool i2c_probe(uint8_t addr) {
    auto &bus = id(i2c_bus);
    i2c::ErrorCode err = bus.write(addr, nullptr, 0, true);
    return err == i2c::ERROR_OK;
  }

  uint8_t i2c_read_reg(uint8_t addr) {
    auto &bus = id(i2c_bus);
    uint8_t data = 0xFF;
    bus.read(addr, &data, 1);
    return data;
  }

  // --- Record result ---
  void record(const char* name, bool pass, const char* detail) {
    tests_done++;
    if (!pass) all_passed = false;
    uint32_t ms = millis() - phase_start;
    int wrote = snprintf(log_buf + log_len, sizeof(log_buf) - log_len,
      "%s: %s (%ums) %s\\n", name, pass ? "PASS" : "FAIL", ms, detail);
    if (wrote > 0 && log_len + wrote < (int)sizeof(log_buf)) log_len += wrote;
    ESP_LOGI("selftest", "%s: %s (%ums) %s", name, pass ? "PASS" : "FAIL", ms, detail);
  }

  // --- Advance to next phase ---
  void next_phase() {
    phase = static_cast<Phase>(static_cast<int>(phase) + 1);
    sub_step = 0;
    step_timer = millis();
    phase_start = millis();
  }

  // --- Update HA entities (only on state change) ---
  void update_ha() {
    if (phase == last_published_phase && tests_done == last_published_tests) return;
    last_published_phase = phase;
    last_published_tests = tests_done;

    int pct = (TOTAL_TESTS > 0) ? (tests_done * 100 / TOTAL_TESTS) : 0;
    id(st_progress).publish_state(pct);
    id(st_phase).publish_state(phase_name(phase));
    id(st_log).publish_state(log_buf);
    if (phase == DONE) {
      id(st_overall).publish_state(all_passed);
      ESP_LOGI("selftest", "======== SUMMARY: %d/%d PASSED ========", all_passed ? TOTAL_TESTS : tests_done, TOTAL_TESTS);
      ESP_LOGI("selftest", "%s", log_buf);
    }
  }
${helpersBlock}

  // --- Probe tick functions ---

${tickFunctions}

  // --- Main tick (100ms interval) ---
  void tick() {
    switch (phase) {
    case IDLE:
      if (auto_start_pending && millis() > 3000) {
        start();
        auto_start_pending = false;
      }
      break;
${dispatchCases}
    case DONE:
      // Single-shot. After the cycle finishes, idle so the user can toggle
      // every entity from the web dashboard (the device's IP on the home
      // network, or 192.168.4.1 on the fallback AP). The "Run Tests" button
      // in the dashboard re-triggers the cycle.
      break;
    }
    update_ha();
  }

  void init() {
    phase = IDLE;
    log_buf[0] = '\\0';
    log_len = 0;
    ESP_LOGI("selftest", "${board.label} self-test ready. Auto-start in 3s...");
  }

  void start() {
    phase = static_cast<Phase>(1);
    sub_step = 0;
    step_timer = millis();
    phase_start = millis();
    tests_done = 0;
    all_passed = true;
    log_buf[0] = '\\0';
    log_len = 0;
    id(st_overall).publish_state(false);
    ESP_LOGI("selftest", "=== Starting ${board.label} Self-Test (%d tests) ===", TOTAL_TESTS);
  }

} // namespace selftest
`;
}
