/**
 * Composes the self-test device YAML from active probes.
 *
 * Common structure (substitutions, esphome block, interval, button, progress,
 * phase/log text sensors) is always present. Each probe adds:
 * - A result binary_sensor (st_result_{id})
 * - A detail text_sensor (st_detail_{id})
 * - Optional internal components (switches, sensors, etc.) via yaml()
 */

import type { BoardDef } from '@far-mon/core';
import type { TestProbe, YamlFragments } from './probe';
import { resultId, detailId } from './probe';

export function generateDeviceYaml(board: BoardDef, probes: TestProbe[]): string {
  const model = board.model.replace('_', '-');
  const lines: string[] = [];

  // Header
  lines.push(`# =============================================================================`);
  lines.push(`# ${board.label} — Self-Test Firmware`);
  lines.push(`# =============================================================================`);
  lines.push(`# AUTO-GENERATED — ${probes.length} test probes active.`);
  lines.push(`# Tests: ${probes.map(p => p.label).join(', ')}`);
  lines.push(`# =============================================================================`);
  lines.push(``);

  // Substitutions
  lines.push(`substitutions:`);
  lines.push(`  device_name: selftest-${model}`);
  lines.push(`  friendly_name: "${board.label} Self-Test"`);
  lines.push(`  update_interval: 5s`);
  if (board.peripherals.battery) {
    lines.push(`  pin_battery_adc: ${board.peripherals.battery.adc_pin}`);
    lines.push(`  battery_divider: "${board.peripherals.battery.divider}"`);
  }
  lines.push(``);

  lines.push(`packages:`);
  lines.push(`  board: !include common/board.yaml`);
  lines.push(``);

  lines.push(`esphome:`);
  lines.push(`  name: \${device_name}`);
  lines.push(`  friendly_name: \${friendly_name}`);
  lines.push(`  includes:`);
  lines.push(`    - packages/self-test.h`);
  lines.push(`  on_boot:`);
  lines.push(`    priority: -100`);
  lines.push(`    then:`);
  lines.push(`      - lambda: 'selftest::init();'`);
  lines.push(``);

  lines.push(`interval:`);
  lines.push(`  - interval: 100ms`);
  lines.push(`    then:`);
  lines.push(`      - lambda: 'selftest::tick();'`);
  lines.push(``);

  // Button
  lines.push(`button:`);
  lines.push(`  - platform: template`);
  lines.push(`    name: "Run Tests"`);
  lines.push(`    id: st_run`);
  lines.push(`    icon: "mdi:play-circle-outline"`);
  lines.push(`    on_press:`);
  lines.push(`      - lambda: 'selftest::start();'`);
  lines.push(``);

  // Collect YAML fragments from all probes, merge by section
  const merged: Record<string, string[]> = {};
  for (const probe of probes) {
    const frags = probe.yaml(board);
    for (const [section, content] of Object.entries(frags)) {
      if (content) (merged[section] ??= []).push(content);
    }
  }

  // --- sensor section ---
  const sensorBlocks = [
    `  - platform: template`,
    `    name: "Test Progress"`,
    `    id: st_progress`,
    `    unit_of_measurement: "%"`,
    `    icon: "mdi:percent-circle-outline"`,
    `    accuracy_decimals: 0`,
  ];
  if (merged['sensor']) {
    sensorBlocks.push('');
    sensorBlocks.push(...merged['sensor']);
  }
  lines.push(`sensor:`);
  lines.push(sensorBlocks.join('\n'));
  lines.push(``);

  // --- text_sensor section ---
  lines.push(`text_sensor:`);
  lines.push(`  - platform: template`);
  lines.push(`    name: "Test Phase"`);
  lines.push(`    id: st_phase`);
  lines.push(`    icon: "mdi:format-list-checks"`);
  lines.push(``);
  lines.push(`  - platform: template`);
  lines.push(`    name: "Test Log"`);
  lines.push(`    id: st_log`);
  lines.push(`    icon: "mdi:text-box-outline"`);
  for (const probe of probes) {
    lines.push(``);
    lines.push(`  - platform: template`);
    lines.push(`    name: "${probe.label} Detail"`);
    lines.push(`    id: ${detailId(probe)}`);
    lines.push(`    icon: "mdi:information-outline"`);
  }
  lines.push(``);

  // --- binary_sensor section ---
  const binaryBlocks = [
    `  - platform: template`,
    `    name: "All Tests Passed"`,
    `    id: st_overall`,
    `    icon: "mdi:check-circle-outline"`,
    `    device_class: connectivity`,
  ];
  for (const probe of probes) {
    binaryBlocks.push(``);
    binaryBlocks.push(`  - platform: template`);
    binaryBlocks.push(`    name: "${probe.label}"`);
    binaryBlocks.push(`    id: ${resultId(probe)}`);
    binaryBlocks.push(`    icon: "mdi:check-decagram"`);
  }
  if (merged['binary_sensor']) {
    binaryBlocks.push('');
    binaryBlocks.push(...merged['binary_sensor']);
  }
  lines.push(`binary_sensor:`);
  lines.push(binaryBlocks.join('\n'));
  lines.push(``);

  // --- switch section ---
  if (merged['switch']) {
    lines.push(`switch:`);
    lines.push(merged['switch'].join('\n\n'));
    lines.push(``);
  }

  // --- any other sections from probes ---
  for (const [section, blocks] of Object.entries(merged)) {
    if (['sensor', 'binary_sensor', 'switch'].includes(section)) continue;
    lines.push(`${section}:`);
    lines.push(blocks.join('\n\n'));
    lines.push(``);
  }

  return lines.join('\n') + '\n';
}
