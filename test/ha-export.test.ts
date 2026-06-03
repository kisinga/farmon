/**
 * HA SCADA export tests — meta sidecar construction.
 *
 * Covers the pure (DOM-free) half of `TopologyRenderer.exportHa()`:
 *  - default action/bind resolution from descriptors
 *  - per-node override precedence
 *  - slot/bind symmetry assertion
 *  - determinism: same input → byte-identical output across runs
 *  - pipe flow predicates
 *
 * Usage: npx tsx test/ha-export.test.ts
 */

import { buildHaMeta, HA_SCHEMA_VERSION, deriveHaEntityId, esphomeServicePrefix, type SiteTopology, type Device } from '@far-mon/core';

let passed = 0;
let failed = 0;

function assert(condition: boolean, name: string, detail?: string) {
  if (condition) {
    console.log(`  \u2713 ${name}`);
    passed++;
  } else {
    console.log(`  \u2717 ${name}${detail ? ` \u2014 ${detail}` : ''}`);
    failed++;
  }
}

function assertThrows(fn: () => unknown, name: string, match?: RegExp) {
  try {
    fn();
    console.log(`  \u2717 ${name} \u2014 did not throw`);
    failed++;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (match && !match.test(msg)) {
      console.log(`  \u2717 ${name} \u2014 threw "${msg}" (expected ${match})`);
      failed++;
    } else {
      console.log(`  \u2713 ${name}`);
      passed++;
    }
  }
}

// --- Fixture: small topology with a mix of mapped + unmapped nodes ---

const FIXED_TIME = '2026-01-01T00:00:00.000Z';

const FIXTURE_DEVICE: Device = Object.freeze({
  name: 'gh-1',
  friendly_name: 'Greenhouse',
  board: 'heltec-v3',
});

function fixture(): SiteTopology {
  // Intentionally divergent: slug(name) = 'gh_1' but slug(friendly_name) = 'greenhouse'.
  // HA derives entity_ids from friendly_name; ESPHome services use name. Both must be testable
  // independently, so the fixture forces them apart.
  return {
    schema: 18,
    controllers: [{
      id: 'gh-1',
      board: 'heltec-v3',
      friendlyName: 'Greenhouse',
    }],
    nodes: [
      {
        kind: 'tank', id: 'tank_main', name: 'Main Tank',
        level_monitored: true, pressure_pin: 'GPIO1', pressure_sensor_max_psi: 15,
        ports: [
          { id: 'inlet', label: 'Inlet', direction: 'inlet' },
          { id: 'outlet', label: 'Outlet', direction: 'outlet' },
        ],
        position: { x: 100, y: 100 },
        anchorId: 'gh-1',
      },
      {
        kind: 'pump', id: 'pump_1', name: 'Pump 1', pin: 'GPIO42',
        ports: [
          { id: 'in', label: 'Inlet', direction: 'inlet' },
          { id: 'out', label: 'Outlet', direction: 'outlet' },
        ],
        position: { x: 250, y: 100 },
        anchorId: 'gh-1',
      },
      {
        kind: 'valve', id: 'valve_a', name: 'Valve A',
        open_pin: 'GPIO4', close_pin: 'GPIO5',
        ports: [
          { id: 'inlet', label: 'Inlet', direction: 'inlet' },
          { id: 'outlet', label: 'Outlet', direction: 'outlet' },
        ],
        position: { x: 400, y: 100 },
        anchorId: 'gh-1',
      },
    ],
    pipes: [
      { id: 'p1', from: 'tank_main:outlet', to: 'pump_1:in' },
      { id: 'p2', from: 'pump_1:out', to: 'valve_a:inlet' },
    ],
    route_overrides: {},
    timing: {
      valve_travel_time: 15, flow_watchdog: 30, flow_confirm: 5,
      flow_threshold: 0.5, api_watchdog: 300, update_interval: 5,
    },
    automations: [],
    remoteImports: [],
  };
}

// --- Setup ---

console.log('HA SCADA Export — Meta sidecar');
console.log('==============================\n');

const meta = buildHaMeta(fixture(), FIXTURE_DEVICE, { viewBox: [0, 0, 1200, 600], generatedAt: FIXED_TIME });

// --- Schema & structure ---

console.log('Schema + structure:');
assert(meta.schemaVersion === HA_SCHEMA_VERSION, `schemaVersion = ${HA_SCHEMA_VERSION}`);
assert(meta.generatedAt === FIXED_TIME, 'generatedAt is fixed');
assert(Array.isArray(meta.viewBox) && meta.viewBox.length === 4, 'viewBox is 4-tuple');
assert(meta.labelTiers.primary > 0 && meta.labelTiers.secondary > meta.labelTiers.primary, 'labelTiers sensible');

// --- Node-level resolution ---

console.log('\nNode resolution:');
assert(!!meta.nodes['pump_1'], 'pump_1 present');
// The pump's firmware-emitted switch is named "Pump Relay" (not the node's
// `name`), so the canonical HA entity_id reflects that — single source of
// truth via descriptor.codegen.haEntityIds. Previously this asserted the
// node's name, which never matched what HA actually saw.
assert(meta.nodes['pump_1'].entityId === 'switch.greenhouse_pump_relay', 'pump_1 carries firmware-emitted entityId');
assert(meta.nodes['pump_1'].kind === 'pump', 'pump_1 carries kind');

const pumpActions = meta.nodes['pump_1'].actions ?? [];
assert(pumpActions.some(a => a.id === 'more-info'), 'pump default actions include more-info');
assert(pumpActions.some(a => a.id === 'toggle' && a.service === 'switch.toggle'), 'pump default actions include toggle w/ switch.toggle');

assert(!!meta.nodes['tank_main'].binds, 'tank carries default binds');
assert(meta.nodes['tank_main'].binds?.['value'] === 'state|format:percent', 'tank default bind is percent on value slot');
// Tank emits its own level entity via intrinsic pressure sensor.
assert(meta.nodes['tank_main'].entityId === 'sensor.greenhouse_main_tank_level', 'tank resolves to its own intrinsic level entity');

assert(!!meta.nodes['valve_a'], 'valve present');
assert(meta.nodes['valve_a'].entityId === 'cover.greenhouse_valve_a', 'valve_a carries derived entityId');
assert((meta.nodes['valve_a'].actions ?? []).length > 0, 'valve_a has default actions');

// --- Pipe flow predicates ---

console.log('\nPipes:');
// p1 (tank→pump) — fromEntity is tank's own level entity.
assert(meta.pipes['p1']?.fromEntity === 'sensor.greenhouse_main_tank_level', 'p1 fromEntity wired (tank level)');
assert(meta.pipes['p1']?.toEntity === 'switch.greenhouse_pump_relay', 'p1 toEntity is pump relay');
assert(meta.pipes['p1']?.flowWhen === `fromEntity.state == 'on'`, 'p1 default flowWhen set');
assert(meta.pipes['p2']?.fromEntity === 'switch.greenhouse_pump_relay', 'p2 fromEntity set');
assert(meta.pipes['p2']?.toEntity === 'cover.greenhouse_valve_a', 'p2 toEntity set');

// --- Determinism: 3 runs produce identical JSON ---

console.log('\nDeterminism:');
const runs = [1, 2, 3].map(() => JSON.stringify(buildHaMeta(fixture(), FIXTURE_DEVICE, { viewBox: [0, 0, 1200, 600], generatedAt: FIXED_TIME })));
assert(runs[0] === runs[1] && runs[1] === runs[2], '3 runs byte-identical');

// Node + pipe keys sorted in emitted object
const nodeKeys = Object.keys(meta.nodes);
const sortedNodeKeys = [...nodeKeys].sort();
assert(JSON.stringify(nodeKeys) === JSON.stringify(sortedNodeKeys), 'node keys are sorted');

const pipeKeys = Object.keys(meta.pipes);
const sortedPipeKeys = [...pipeKeys].sort();
assert(JSON.stringify(pipeKeys) === JSON.stringify(sortedPipeKeys), 'pipe keys are sorted');

// --- Override precedence ---

console.log('\nOverride precedence:');
const withOverride = fixture();
// pump_1 is at index 1 (tank, pump, valve).
withOverride.nodes[1].haActions = [{ id: 'custom', label: 'Custom', service: 'script.my_custom' }];
withOverride.nodes[1].binds = { label: 'attributes.current_power|format:watts' };
const metaOv = buildHaMeta(withOverride, FIXTURE_DEVICE, { viewBox: [0, 0, 1200, 600], generatedAt: FIXED_TIME });
assert(metaOv.nodes['pump_1'].actions?.length === 1, 'per-node actions replace defaults entirely');
assert(metaOv.nodes['pump_1'].actions?.[0].id === 'custom', 'override action id wins');
assert(metaOv.nodes['pump_1'].binds?.['label'] === 'attributes.current_power|format:watts', 'override bind wins');

// --- Slot/bind symmetry ---

console.log('\nSlot/bind symmetry:');
assertThrows(
  () => {
    const bad = fixture();
    // tank declares slots { label, value }; binding onto a slot it doesn't declare should throw.
    bad.nodes[0].binds = { nonexistent: 'state' };
    buildHaMeta(bad, FIXTURE_DEVICE, { viewBox: [0, 0, 1200, 600], generatedAt: FIXED_TIME });
  },
  'throws on unknown slot in binds',
  /does not declare it/,
);

assertThrows(
  () => {
    const bad = fixture();
    bad.nodes[0].binds = { label: 'invalid!!!' };
    buildHaMeta(bad, FIXTURE_DEVICE, { viewBox: [0, 0, 1200, 600], generatedAt: FIXED_TIME });
  },
  'throws on malformed bind expression',
  /Invalid bind expression/,
);

// --- Entity ID derivation contract ---
//
// Pinning the SSOT: HA prefix comes from friendly_name; ESPHome service prefix
// comes from name. The two are deliberately divergent in the fixture to ensure
// neither helper silently falls back to the other field.

console.log('\nEntity ID derivation:');
const dev = { name: 'gh-1', friendly_name: 'Greenhouse' };
assert(
  deriveHaEntityId('sensor', dev, 'System State') === 'sensor.greenhouse_system_state',
  'deriveHaEntityId uses slug(friendly_name) prefix',
);
assert(
  esphomeServicePrefix(dev) === 'gh_1',
  'esphomeServicePrefix uses slug(name)',
);
assert(
  deriveHaEntityId('sensor', dev, 'System State') !== `sensor.${esphomeServicePrefix(dev)}_system_state`,
  'HA entity prefix and ESPHome service prefix are independent (regression guard)',
);

// --- Summary ---

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
