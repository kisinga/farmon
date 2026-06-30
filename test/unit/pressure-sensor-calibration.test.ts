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
  evaluatePressureSensorLowResolution,
  evaluatePressureSensorOverRange,
  defaultSensorVMaxV,
  ADC_PIN_REF_V,
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
  assert(numberSection.includes('initial_value: 2.84'), 'calEmpty seeded to ≈ 2.84 psi (PSI_PER_M × elevation)');
  assert(numberSection.includes('initial_value: 9.96'), 'calFull seeded to ≈ 9.96 psi (PSI_PER_M × (elevation + height))');
  assert(numberSection.includes('Tank Pressure Cal Empty (psi)'), 'HA entity label uses psi unit');
  assert(!numberSection.includes('Sensor Min') && !numberSection.includes('Sensor Max'),
    'sensor psi range is baked, not a runtime entity');
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
  assert(numberSection.includes('initial_value: 2.84'), 'calEmpty seeded from tank height + elevation');
  assert(numberSection.includes('initial_value: 9.96'), 'calFull seeded from tank height + elevation');
  assert(!numberSection.includes('Sensor Max'), 'sensor range not emitted as a runtime entity');
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
  // Range baked (0..15 psi), no runtime r_min/r_max entities; default scaling 0→3.3V.
  assert(yaml.includes('((x - 0.0f) / 3.3f) * 15.0f'), 'voltage→psi map baked: x/3.3 × 15 psi');
  assert(!yaml.includes('id(') || !yaml.includes('range_min'), 'no runtime range entity referenced');
}

// Voltage→pressure scaling baked from board ADC range + sensor v_min/v_max.
console.log('\nADC scaling:');
{
  const ctx5: import('@core').CodegenContext = {
    resolveChannel: () => ({ platform: 'adc', config: 'pin:\n    number: GPIO19', adcFullScaleV: 5 }),
  };
  // 0-3.3V sensor on a 0-5V board → full output reaches 3.3 × 3.3/5 = 2.178V at the pin.
  const node33 = { ...tankWithPressure, pressure_v_max: 3.3 };
  assert(tankDescriptor.codegen!.sensors!(node33, 0, ctx5).includes('/ 2.178f) * 15.0f'),
    '3.3V sensor on a 5V board → span 2.178f');
  // Offset sensor (0.5-4.5V) on a 5V board → lo 0.33V, hi 2.97V at the pin.
  const ratio = { ...tankWithPressure, pressure_v_min: 0.5, pressure_v_max: 4.5 };
  assert(tankDescriptor.codegen!.sensors!(ratio, 0, ctx5).includes('(x - 0.33f) / 2.64f'),
    '0.5-4.5V sensor → lo 0.33f, span 2.64f');
  // Blank v_max = swings the full board range → 0→3.3V at the pin.
  assert(tankDescriptor.codegen!.sensors!(tankWithPressure, 0, ctx5).includes('((x - 0.0f) / 3.3f)'),
    'blank v_max on a 5V board → span 3.3f');
  // SINGLE SOURCE: the editor's blank-field placeholder and codegen's blank-default
  // both resolve through defaultSensorVMaxV, so a sensor left unset can't read one
  // default in the UI and bake a different one in firmware (the rain-tank bug).
  assert(defaultSensorVMaxV(5) === 5, 'blank v_max default on a 5V board is 5V');
  assert(defaultSensorVMaxV(0) === ADC_PIN_REF_V, 'unresolved board range falls back to the 3.3V pin ref');
}

// Over-range: sensor full output beyond the board ADC input range is an error.
{
  assert(evaluatePressureSensorOverRange([{ id: 't', name: 'Tank', v_max: 5, board_adc_range_v: 3.3 }]).length === 1,
    'over-range: 5V sensor on a 3.3V input flagged');
  assert(evaluatePressureSensorOverRange([{ id: 't', name: 'Tank', v_max: 3.3, board_adc_range_v: 5 }]).length === 0,
    'no over-range when sensor output ≤ board range');
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

// Usable resolution = how much of the sensor's pressure range the tank swing uses.
// Voltage is NOT a factor (the ADC has far more steps than a level needs).
console.log('\nUsable resolution (pressure-range only):');

{
  // 2 m tank, 20 m elevation, 50 psi sensor: ~2.84 psi swing = ~6% of range → fires.
  const r = evaluatePressureSensorLowResolution([
    { id: 't', name: 'Tank', sensor_max_psi: 50, elevation_m: 20, tank_height_m: 2 },
  ]);
  assert(r.length === 1, 'fires for elevated tank with poor pressure-range use');
  assert(r[0].message.includes('noise'), 'message explains the near-noise reading');
}

{
  // Well-matched 15 psi sensor on a 5 m tank (~47% span) → no warning, regardless
  // of any sensor voltage (voltage no longer enters resolution).
  const r = evaluatePressureSensorLowResolution([
    { id: 't', name: 'Tank', sensor_max_psi: 15, elevation_m: 0, tank_height_m: 5 },
  ]);
  assert(r.length === 0, 'no warning when the tank uses a healthy slice of the range');
}

{
  // Undersized sensor → owned by the undersized rule, resolution stays silent.
  const r = evaluatePressureSensorLowResolution([
    { id: 't', name: 'Tank', sensor_max_psi: 5, elevation_m: 0, tank_height_m: 5 },
  ]);
  assert(r.length === 0, 'does not fire when the sensor is already undersized');
}

// ---------------------------------------------------------------------------

console.log(`\n${'='.repeat(40)}`);
console.log(`${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
