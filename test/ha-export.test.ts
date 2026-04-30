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

import { buildHaMeta, HA_SCHEMA_VERSION, type SystemTopology } from '@far-mon/core';

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

function fixture(): SystemTopology {
  return {
    schema: 11,
    device: { name: 'greenhouse', friendly_name: 'Greenhouse', board: 'heltec_v3' },
    nodes: [
      {
        kind: 'tank', id: 'tank_main', name: 'Main Tank',
        ports: [
          { id: 'inlet', label: 'Inlet', direction: 'inlet' },
          { id: 'outlet', label: 'Outlet', direction: 'outlet' },
        ],
        position: { x: 100, y: 100 },
      } as any,
      {
        kind: 'pump', id: 'pump_1', name: 'Pump 1', pin: 'GPIO42',
        ports: [
          { id: 'in', label: 'Inlet', direction: 'inlet' },
          { id: 'out', label: 'Outlet', direction: 'outlet' },
        ],
        position: { x: 250, y: 100 },
      } as any,
      {
        kind: 'valve', id: 'valve_a', name: 'Valve A',
        open_pin: 'GPIO4', close_pin: 'GPIO5',
        ports: [
          { id: 'inlet', label: 'Inlet', direction: 'inlet' },
          { id: 'outlet', label: 'Outlet', direction: 'outlet' },
        ],
        position: { x: 400, y: 100 },
      } as any,
    ],
    pipes: [
      { id: 'p1', from: 'tank_main:outlet', to: 'pump_1:in' },
      { id: 'p2', from: 'pump_1:out', to: 'valve_a:inlet' },
    ],
    route_overrides: {},
    timing: {
      valve_travel_time: 15, flow_watchdog: 30, flow_confirm: 5,
      api_watchdog: 300, update_interval: 5,
    },
    automations: [],
  };
}

// --- Setup ---

console.log('HA SCADA Export — Meta sidecar');
console.log('==============================\n');

const meta = buildHaMeta(fixture(), { viewBox: [0, 0, 1200, 600], generatedAt: FIXED_TIME });

// --- Schema & structure ---

console.log('Schema + structure:');
assert(meta.schemaVersion === HA_SCHEMA_VERSION, `schemaVersion = ${HA_SCHEMA_VERSION}`);
assert(meta.generatedAt === FIXED_TIME, 'generatedAt is fixed');
assert(Array.isArray(meta.viewBox) && meta.viewBox.length === 4, 'viewBox is 4-tuple');
assert(meta.labelTiers.primary > 0 && meta.labelTiers.secondary > meta.labelTiers.primary, 'labelTiers sensible');

// --- Node-level resolution ---

console.log('\nNode resolution:');
assert(!!meta.nodes['pump_1'], 'pump_1 present');
assert(meta.nodes['pump_1'].entityId === 'switch.greenhouse_pump_1', 'pump_1 carries derived entityId');
assert(meta.nodes['pump_1'].kind === 'pump', 'pump_1 carries kind');

const pumpActions = meta.nodes['pump_1'].actions ?? [];
assert(pumpActions.some(a => a.id === 'more-info'), 'pump default actions include more-info');
assert(pumpActions.some(a => a.id === 'toggle' && a.service === 'switch.toggle'), 'pump default actions include toggle w/ switch.toggle');

assert(!!meta.nodes['tank_main'].binds, 'tank carries default binds');
assert(meta.nodes['tank_main'].binds?.['value'] === 'state|format:percent', 'tank default bind is percent on value slot');

assert(!!meta.nodes['valve_a'], 'valve present');
assert(meta.nodes['valve_a'].entityId === 'cover.greenhouse_valve_a', 'valve_a carries derived entityId');
assert((meta.nodes['valve_a'].actions ?? []).length > 0, 'valve_a has default actions');

// --- Pipe flow predicates ---

console.log('\nPipes:');
assert(meta.pipes['p1']?.fromEntity === 'sensor.greenhouse_main_tank', 'p1 fromEntity wired');
assert(meta.pipes['p1']?.toEntity === 'switch.greenhouse_pump_1', 'p1 toEntity wired');
assert(meta.pipes['p1']?.flowWhen === `fromEntity.state == 'on'`, 'p1 default flowWhen set');
assert(meta.pipes['p2']?.fromEntity === 'switch.greenhouse_pump_1', 'p2 fromEntity set');
assert(meta.pipes['p2']?.toEntity === 'cover.greenhouse_valve_a', 'p2 toEntity set');

// --- Determinism: 3 runs produce identical JSON ---

console.log('\nDeterminism:');
const runs = [1, 2, 3].map(() => JSON.stringify(buildHaMeta(fixture(), { viewBox: [0, 0, 1200, 600], generatedAt: FIXED_TIME })));
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
(withOverride.nodes[1] as any).haActions = [{ id: 'custom', label: 'Custom', service: 'script.my_custom' }];
(withOverride.nodes[1] as any).binds = { label: 'attributes.current_power|format:watts' };
const metaOv = buildHaMeta(withOverride, { viewBox: [0, 0, 1200, 600], generatedAt: FIXED_TIME });
assert(metaOv.nodes['pump_1'].actions?.length === 1, 'per-node actions replace defaults entirely');
assert(metaOv.nodes['pump_1'].actions?.[0].id === 'custom', 'override action id wins');
assert(metaOv.nodes['pump_1'].binds?.['label'] === 'attributes.current_power|format:watts', 'override bind wins');

// --- Slot/bind symmetry ---

console.log('\nSlot/bind symmetry:');
assertThrows(
  () => {
    const bad = fixture();
    // tank declares slots { label, value }; binding onto a slot it doesn't declare should throw.
    (bad.nodes[0] as any).binds = { nonexistent: 'state' };
    buildHaMeta(bad, { viewBox: [0, 0, 1200, 600], generatedAt: FIXED_TIME });
  },
  'throws on unknown slot in binds',
  /does not declare it/,
);

assertThrows(
  () => {
    const bad = fixture();
    (bad.nodes[0] as any).binds = { label: 'invalid!!!' };
    buildHaMeta(bad, { viewBox: [0, 0, 1200, 600], generatedAt: FIXED_TIME });
  },
  'throws on malformed bind expression',
  /Invalid bind expression/,
);

// --- Summary ---

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
