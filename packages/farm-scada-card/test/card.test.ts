/**
 * farm-scada-card unit tests — pure modules.
 *
 * The card itself depends on DOM + Lit, but the state/bucket mapping and
 * bind resolver are pure functions and covered here. Integration of the
 * rendered card is left to manual testing against a HA dev instance.
 *
 * Usage: npx tsx packages/farm-scada-card/test/card.test.ts
 */

import { stateBucket } from '../src/state';
import { resolveBind } from '../src/value-bindings';

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

function eq<T>(actual: T, expected: T, name: string) {
  assert(actual === expected, name, `got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`);
}

// ---------------------------------------------------------------------------

console.log('farm-scada-card — state bucket');
console.log('==============================\n');

eq(stateBucket('on'), 'on', 'on → on');
eq(stateBucket('off'), 'off', 'off → off');
eq(stateBucket('open'), 'on', 'open → on');
eq(stateBucket('closed'), 'off', 'closed → off');
eq(stateBucket('unavailable'), 'unavailable', 'unavailable → unavailable');
eq(stateBucket('unknown'), 'unknown', 'unknown → unknown');
eq(stateBucket('problem'), 'fault', 'problem → fault');
eq(stateBucket('42'), 'on', 'numeric 42 → on');
eq(stateBucket('0'), 'on', 'numeric 0 still parses → on');
eq(stateBucket(undefined), 'unknown', 'undefined → unknown');
eq(stateBucket('mystery'), 'unknown', 'unrecognized text → unknown');

// ---------------------------------------------------------------------------

console.log('\nfarm-scada-card — bind resolver');
console.log('===============================\n');

const pumpOn = { state: 'on', attributes: { current_power: 2345 } };
const tankLvl = { state: '62.5', attributes: { level: 62.5, sensor: { reading: 3.3 } } };
const sensorMissing = { state: 'unavailable', attributes: {} };

eq(resolveBind('state', pumpOn), 'on', 'state → raw state');
eq(resolveBind('state|format:number:1', tankLvl), '62.5', 'state|format:number:1');
eq(resolveBind('state|format:percent', tankLvl), '63%', 'state|format:percent rounds');
eq(resolveBind('attributes.current_power', pumpOn), '2345', 'attributes.current_power raw');
eq(resolveBind('attributes.current_power|format:watts', pumpOn), '2.3 kW', 'watts above 1000 → kW');
eq(resolveBind('attributes.current_power|format:watts', { state: 'on', attributes: { current_power: 42 } }), '42 W', 'watts below 1000 → W');
eq(resolveBind('attributes.sensor.reading|format:number:2', tankLvl), '3.30', 'dotted attribute path');
eq(resolveBind('attributes.missing', pumpOn), '\u2014', 'missing attr → em dash');
eq(resolveBind('state', sensorMissing), 'unavailable', 'unavailable state still a string');
eq(resolveBind('state', undefined), '\u2014', 'undefined hass object → em dash');

// ---------------------------------------------------------------------------

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
