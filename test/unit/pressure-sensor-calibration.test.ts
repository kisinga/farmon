/**
 * Unit tests for pressure-sensor tank calibration: derived seeds, sensor
 * recommendation, and ESPHome codegen output.
 *
 * Usage: npx tsx test/unit/pressure-sensor-calibration.test.ts
 */

import {
  deriveTankCalibration,
  recommendSensorMaxPsi,
  PSI_PER_M,
  STANDARD_PSI,
  NODE_REGISTRY,
  parseTopology,
  emitPressureCalNumbers,
  emitPressureSensorYaml,
} from '../../src/lib/index';
import type { TankNode } from '../../src/lib/entities/tank';

const tankDescriptor = NODE_REGISTRY.get('tank')!;

let passed = 0;
let failed = 0;

function assert(condition: boolean, name: string, detail?: string) {
  if (condition) {
    console.log(`  ✓ ${name}`);
    passed++;
  } else {
    console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`);
    failed++;
  }
}

function approx(a: number, b: number, eps = 0.01): boolean {
  return Math.abs(a - b) < eps;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

console.log('Constants:');
assert(approx(PSI_PER_M, 1.42233), `PSI_PER_M = 1.42233 (got ${PSI_PER_M})`);
assert(STANDARD_PSI.length >= 5, `STANDARD_PSI has at least 5 sizes`);
assert(STANDARD_PSI[0] === 5, `STANDARD_PSI starts at 5`);
assert(STANDARD_PSI.includes(15), `STANDARD_PSI includes 15`);
assert(STANDARD_PSI.includes(100), `STANDARD_PSI includes 100`);

// ---------------------------------------------------------------------------
// deriveTankCalibration
// ---------------------------------------------------------------------------

console.log('\nderiveTankCalibration:');

{
  // 5 m tank, 2 m elevation: P_empty ≈ 2.84 psi, P_full ≈ 9.96 psi
  const cal = deriveTankCalibration(5, 2);
  assert(approx(cal.p_empty_psi, 2.8447), `5m+2m elev: p_empty ≈ 2.84 psi (got ${cal.p_empty_psi.toFixed(4)})`);
  assert(approx(cal.p_full_psi, 9.9563), `5m+2m elev: p_full ≈ 9.96 psi (got ${cal.p_full_psi.toFixed(4)})`);
  assert(approx(cal.working_span_psi, 7.1117), `5m+2m elev: span ≈ 7.11 psi`);
}

{
  // 3 m tank, no elevation: P_empty = 0
  const cal = deriveTankCalibration(3, 0);
  assert(cal.p_empty_psi === 0, `3m+0 elev: p_empty = 0`);
  assert(approx(cal.p_full_psi, 4.267), `3m+0 elev: p_full ≈ 4.27 psi`);
  assert(approx(cal.working_span_psi, 4.267), `3m+0 elev: span = full when elevation 0`);
}

// ---------------------------------------------------------------------------
// recommendSensorMaxPsi
// ---------------------------------------------------------------------------

console.log('\nrecommendSensorMaxPsi:');

{
  // 9.96 psi P_full → target = 14.94 psi → 15 psi (smallest standard ≥ 14.94)
  assert(recommendSensorMaxPsi(9.9563) === 15, `P_full=9.96 → recommends 15 psi`);
}
{
  // 4.27 psi P_full → target = 6.4 psi → 10 psi (smallest standard ≥ 6.4; 5 is too small)
  assert(recommendSensorMaxPsi(4.267) === 10, `P_full=4.27 → recommends 10 psi (5 is too small after 1.5x)`);
}
{
  // 2 psi P_full → target = 3 psi → 5 psi (smallest available)
  assert(recommendSensorMaxPsi(2) === 5, `P_full=2 → recommends 5 psi (smallest standard size)`);
}
{
  // 80 psi P_full → target = 120 psi → 100 (max in list, function clamps)
  // The 1.5x rule says we'd want bigger than 100, but no standard size exists.
  // Verify the function returns the largest available rather than throwing.
  const r = recommendSensorMaxPsi(80);
  assert(r === 100, `P_full=80 (target 120 > 100) → returns largest available, got ${r}`);
}

// ---------------------------------------------------------------------------
// Shared helper: emitPressureCalNumbers
// ---------------------------------------------------------------------------

console.log('\nShared helper: emitPressureCalNumbers');

{
  const components = emitPressureCalNumbers(
    { id: 'ps_test', name: 'Tank Pressure', sensor_max_psi: 15, elevation_m: 2 },
    5, // tank height
  );
  const numberSection = components.number ?? '';
  assert(numberSection.includes('initial_value: 0'), 'rangeMin seeded to 0 (sensor electrical bottom)');
  assert(numberSection.includes('initial_value: 15'), 'rangeMax seeded to sensor_max_psi (15)');
  assert(numberSection.includes('initial_value: 2.84'), 'calEmpty seeded to ≈ 2.84 psi (PSI_PER_M × elevation)');
  assert(numberSection.includes('initial_value: 9.96'), 'calFull seeded to ≈ 9.96 psi (PSI_PER_M × (elevation + height))');
  assert(numberSection.includes('Tank Pressure Cal Empty (psi)'), 'HA entity label uses psi unit');
  assert(numberSection.includes('Tank Pressure Sensor Max (psi)'), 'sensor max label uses psi unit');
  assert(numberSection.includes('max_value: 200'), 'number entity bounds widened to 200 psi');
  assert(!numberSection.includes('(bar)'), 'no remaining bar references');
}

// ---------------------------------------------------------------------------
// Tank descriptor codegen — intrinsic pressure sensor
// ---------------------------------------------------------------------------

console.log('\nTank descriptor codegen: intrinsic pressure sensor');

const tankWithPressure: TankNode = {
  kind: 'tank',
  id: 'tank1',
  name: 'Rain Tank',
  height_m: 5,
  capacity_l: 10000,
  level_monitored: true,
  pressure_pin: 'GPIO19',
  pressure_elevation_m: 2,
  pressure_sensor_max_psi: 15,
  pressure_pump_rated: true,
  ports: [{ id: 'inlet', label: 'Inlet', direction: 'inlet' }, { id: 'outlet', label: 'Outlet', direction: 'outlet' }],
  position: { x: 0, y: 0 },
  anchorId: 'ctrl',
};

{
  const dummyCtx: import('@core').CodegenContext = {
    resolveChannel: () => ({ platform: 'template', config: '' }),
  };
  const components = tankDescriptor.codegen!.extraComponents!(tankWithPressure, 0, dummyCtx);
  const numberSection = components.number ?? '';
  assert(numberSection.includes('initial_value: 0'), 'rangeMin seeded to 0');
  assert(numberSection.includes('initial_value: 15'), 'rangeMax seeded to sensor_max_psi');
  assert(numberSection.includes('initial_value: 2.84'), 'calEmpty seeded from tank height + elevation');
  assert(numberSection.includes('initial_value: 9.96'), 'calFull seeded from tank height + elevation');
}

{
  const ctx: import('@core').CodegenContext = {
    resolveChannel: () => ({
      platform: 'adc',
      config: 'pin:\n    number: GPIO19',
    }),
  };
  const yaml = tankDescriptor.codegen!.sensors!(tankWithPressure, 0, ctx);
  assert(yaml.includes('unit_of_measurement: "psi"'), 'pressure sensor block emits psi unit');
  assert(!yaml.includes('unit_of_measurement: "bar"'), 'no bar unit anywhere');
  assert(yaml.includes('Rain Tank Pressure'), 'pressure sensor name preserved');
  assert(yaml.includes('Rain Tank Level'), 'level template name preserved');
}

// ---------------------------------------------------------------------------
// Legacy topology migration — bar range → psi range (on tank intrinsic sensor)
// ---------------------------------------------------------------------------

console.log('\nLegacy topology migration:');

{
  const migrated = parseTopology({
    schema: 11,
    device: { name: 'legacy_pressure', friendly_name: 'Legacy Pressure', board: 'kc868-a16' },
    nodes: [{
      kind: 'tank',
      id: 'tank_legacy',
      name: 'Legacy Tank',
      pressure_pin: 'GPIO34',
      min_bar: 0,
      max_bar: 10,
      ports: [{ id: 'inlet', label: 'Inlet', direction: 'inlet' }, { id: 'outlet', label: 'Outlet', direction: 'outlet' }],
      position: { x: 0, y: 0 },
    }],
  });
  const tank = migrated.nodes[0] as TankNode;
  assert(approx(tank.pressure_sensor_max_psi!, 145.04), 'legacy max_bar=10 migrates to sensor_max_psi≈145.04');
  assert(!('max_bar' in tank), 'legacy max_bar is stripped after migration');
  assert(!('min_bar' in tank), 'legacy min_bar is stripped after migration');
}

// ---------------------------------------------------------------------------
// Tank descriptor validation rules
// ---------------------------------------------------------------------------

console.log('\nValidation rules: tank descriptor');

const undersizedRule = tankDescriptor.rules!.find(r => r.id === 'tank-pressure-undersized')!;
assert(undersizedRule !== undefined, 'tank-pressure-undersized rule registered');
assert(undersizedRule.severity === 'warning', 'severity is warning');

{
  // 5 m tank, 2 m elevation, 5 psi sensor → P_full ≈ 9.96, recommended 15. 5 < 15 → warns.
  const nodes = [{ ...tankWithPressure, pressure_sensor_max_psi: 5 }];
  const results = undersizedRule.evaluate(nodes, nodes);
  assert(results.length === 1, 'fires for 5 psi sensor on 5m+2m tank');
  assert(results[0].message.includes('15 psi'), 'message recommends 15 psi');
}

{
  // 5 m tank, 2 m elevation, 15 psi sensor → matches recommendation, no warning.
  const nodes = [tankWithPressure];
  const results = undersizedRule.evaluate(nodes, nodes);
  assert(results.length === 0, 'no warning for properly sized sensor');
}

{
  // Tank without pressure sensor config → rule does not fire
  const nodes = [{ ...tankWithPressure, pressure_pin: undefined, pressure_sensor_max_psi: undefined }];
  const results = undersizedRule.evaluate(nodes, nodes);
  assert(results.length === 0, 'no warning when tank has no pressure sensor config');
}

const elevatedLowResolutionRule = tankDescriptor.rules!.find(r => r.id === 'tank-pressure-elevated-low-resolution')!;
assert(elevatedLowResolutionRule !== undefined, 'tank-pressure-elevated-low-resolution rule registered');
assert(elevatedLowResolutionRule.severity === 'warning', 'severity is warning');

{
  // 2 m tank, 20 m elevation, 50 psi sensor → range/headroom is adequate,
  // but the useful tank swing is only ≈2.84 psi, about 6% of sensor range.
  const nodes = [{ ...tankWithPressure, height_m: 2, pressure_elevation_m: 20, pressure_sensor_max_psi: 50 }];
  const results = elevatedLowResolutionRule.evaluate(nodes, nodes);
  assert(results.length === 1, 'fires for elevated tank with poor working-span utilisation');
  assert(results[0].message.includes('Resolution may be poor'), 'message explains resolution risk');
  assert(results[0].message.includes('pressure reducing/regulating'), 'message mentions pressure regulation option');
}

{
  // Same geometry, but 30 psi is undersized for headroom, so the undersized
  // rule owns the diagnostic rather than emitting two competing warnings.
  const nodes = [{ ...tankWithPressure, height_m: 2, pressure_elevation_m: 20, pressure_sensor_max_psi: 30 }];
  const results = elevatedLowResolutionRule.evaluate(nodes, nodes);
  assert(results.length === 0, 'does not fire when the sensor is already undersized');
}

{
  // Low utilisation can happen without elevation too, but this PRV-oriented
  // rule is specifically about elevated tanks with high empty pressure.
  const nodes = [{ ...tankWithPressure, height_m: 1, pressure_elevation_m: 0, pressure_sensor_max_psi: 10 }];
  const results = elevatedLowResolutionRule.evaluate(nodes, nodes);
  assert(results.length === 0, 'does not fire without elevation offset');
}

// ---------------------------------------------------------------------------

console.log(`\n${'='.repeat(40)}`);
console.log(`${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
