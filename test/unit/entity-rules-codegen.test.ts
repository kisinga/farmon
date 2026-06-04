/**
 * Unit tests for filter codegen, dosing-pump codegen, REGISTRY_RULES,
 * and entity constraints.
 *
 * Covers the known gap: "No tests for filter/dosing codegen,
 * REGISTRY_RULES, or new constraints."
 *
 * Usage: npx tsx test/unit/entity-rules-codegen.test.ts
 */

import { REGISTRY_RULES, NODE_REGISTRY } from '../../src/lib/entity-registry';
import type { FilterNode } from '../../src/lib/entities/filter';
import type { DosingPumpNode } from '../../src/lib/entities/dosing-pump';

const filterDescriptor = NODE_REGISTRY.get('filter')!;
const dosingPumpDescriptor = NODE_REGISTRY.get('dosing_pump')!;

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

// ---------------------------------------------------------------------------
// Filter codegen — sensors
// ---------------------------------------------------------------------------

console.log('Filter codegen:');

const filterNode: FilterNode = {
  kind: 'filter',
  id: 'f1',
  name: 'Main Filter',
  inlet_pressure_pin: 'GPIO19',
  outlet_pressure_pin: 'GPIO20',
  disabled: false,
  ports: [{ id: 'inlet', label: 'Inlet', direction: 'inlet' }],
  position: { x: 0, y: 0 },
};

{
  const sensors = filterDescriptor.codegen!.sensors!(filterNode, 0);
  assert(sensors.includes('f1_inlet_pressure'), 'Inlet ADC sensor uses filterInletPressureId');
  assert(sensors.includes('f1_outlet_pressure'), 'Outlet ADC sensor uses filterOutletPressureId');
  assert(sensors.includes('f1_delta_pressure'), 'Differential template sensor generated when both pins present');
  assert(sensors.includes('platform: adc'), 'Uses ADC platform for pressure sensors');
  assert(sensors.includes('platform: template'), 'Uses template platform for delta sensor');
  assert(sensors.includes('"Main Filter Inlet Pressure"'), 'Inlet sensor has correct name');
  assert(sensors.includes('"Main Filter Differential Pressure"'), 'Delta sensor has correct name');
  assert(sensors.includes('inlet - outlet'), 'Lambda computes inlet minus outlet');
}

// Only inlet pin
{
  const partial: FilterNode = { ...filterNode, outlet_pressure_pin: undefined };
  const sensors = filterDescriptor.codegen!.sensors!(partial, 0);
  assert(sensors.includes('f1_inlet_pressure'), 'Inlet-only: inlet sensor generated');
  assert(!sensors.includes('f1_outlet_pressure'), 'Inlet-only: no outlet sensor');
  assert(!sensors.includes('f1_delta_pressure'), 'Inlet-only: no delta sensor');
}

// No pins at all
{
  const noPins: FilterNode = { ...filterNode, inlet_pressure_pin: undefined, outlet_pressure_pin: undefined };
  const sensors = filterDescriptor.codegen!.sensors!(noPins, 0);
  assert(sensors === '', 'No pins: sensors returns empty string');
}

// ---------------------------------------------------------------------------
// Dosing pump codegen — hardware
// ---------------------------------------------------------------------------

console.log('\nDosing pump codegen:');

const doserNode: DosingPumpNode = {
  kind: 'dosing_pump',
  id: 'dp1',
  name: 'Chlorine Doser',
  pin: 'GPIO42',
  flow_rate_ml_min: 150,
  disabled: false,
  ports: [{ id: 'inlet', label: 'Inlet', direction: 'inlet' }],
  position: { x: 0, y: 0 },
};

{
  const hw = dosingPumpDescriptor.codegen!.hardware!(doserNode, 0);
  assert(hw.includes('dp1_relay'), 'Switch ID uses dosingPumpSwitchId');
  assert(hw.includes('platform: gpio'), 'Uses GPIO platform');
  assert(hw.includes('"Chlorine Doser Relay"'), 'Switch has correct name');
  assert(hw.includes('restore_mode: ALWAYS_OFF'), 'Defaults to ALWAYS_OFF');
  assert(hw.includes('internal: true'), 'Marked internal');
  assert(hw.includes('# --- Chlorine Doser ---'), 'Header comment with node name');
}

// ---------------------------------------------------------------------------
// Filter entity rule — pressure warning
// ---------------------------------------------------------------------------

console.log('\nFilter entity rules:');

{
  const rule = filterDescriptor.rules![0];
  assert(rule.id === 'filter-pressure-warning', 'Rule ID is filter-pressure-warning');
  assert(rule.severity === 'warning', 'Rule severity is warning');
}

{
  const noPins = [{ id: 'f1', name: 'F1', kind: 'filter' }];
  const results = filterDescriptor.rules![0].evaluate(noPins, noPins);
  assert(results.length === 1, 'Fires when no pressure pins configured');
  assert(results[0].message.includes('Blockage detection'), 'Message mentions blockage detection');
  assert(results[0].target === 'f1', 'Target is the node id');
}

{
  const withPins = [{ id: 'f2', name: 'F2', kind: 'filter', inlet_pressure_pin: 'GPIO19' }];
  const results = filterDescriptor.rules![0].evaluate(withPins, withPins);
  assert(results.length === 0, 'Does not fire when at least one pin is configured');
}

// ---------------------------------------------------------------------------
// REGISTRY_RULES — experimental-no-codegen
// ---------------------------------------------------------------------------

console.log('\nREGISTRY_RULES — experimental-no-codegen:');

const expNoCgRule = REGISTRY_RULES.find(r => r.id === 'experimental-no-codegen')!;

{
  // Simulate an experimental entity with no codegen
  // We can't easily add to the registry, so test with a kind that doesn't exist
  // (NODE_REGISTRY.get returns undefined, so desc?.experimental is falsy → no match)
  // Instead, use the fact that filter is experimental WITH codegen — should NOT fire
  const filterNodes = [{ id: 'f1', name: 'Filter 1', kind: 'filter' }];
  const results = expNoCgRule.evaluate([], filterNodes);
  assert(results.length === 0, 'No warning for experimental entity WITH codegen (filter)');
}

{
  // An unknown kind maps to undefined descriptor → no match (safe)
  const unknownNodes = [{ id: 'x1', name: 'Unknown', kind: 'nonexistent_kind' }];
  const results = expNoCgRule.evaluate([], unknownNodes);
  assert(results.length === 0, 'No warning for unknown kinds');
}

{
  // Non-experimental entity with codegen should not fire
  const pumpNodes = [{ id: 'p1', name: 'Pump', kind: 'pump' }];
  const results = expNoCgRule.evaluate([], pumpNodes);
  assert(results.length === 0, 'No warning for non-experimental entity with codegen');
}

// ---------------------------------------------------------------------------
// REGISTRY_RULES — pump-id-uniqueness
// ---------------------------------------------------------------------------

console.log('\nREGISTRY_RULES — pump-id-uniqueness:');

const pumpUniqRule = REGISTRY_RULES.find(r => r.id === 'pump-id-uniqueness')!;

{
  const onePump = [{ id: 'p1', name: 'Main Pump', kind: 'pump' }];
  const results = pumpUniqRule.evaluate([], onePump);
  assert(results.length === 0, 'Single pump: no error');
}

{
  const twoPumps = [
    { id: 'p1', name: 'Pump A', kind: 'pump' },
    { id: 'p2', name: 'Pump B', kind: 'pump' },
  ];
  const results = pumpUniqRule.evaluate([], twoPumps);
  assert(results.length === 1, 'Two pumps: one error');
  assert(results[0].target === 'p2', 'Error targets the second pump');
  assert(results[0].message.includes('Pump B'), 'Error message names the duplicate');
}

{
  // Dosing pump is NOT isPump — should not trigger uniqueness
  const pumpAndDoser = [
    { id: 'p1', name: 'Main Pump', kind: 'pump' },
    { id: 'dp1', name: 'Doser', kind: 'dosing_pump' },
  ];
  const results = pumpUniqRule.evaluate([], pumpAndDoser);
  assert(results.length === 0, 'Pump + dosing pump: no error (dosing pump is not isPump)');
}

{
  const noPumps = [
    { id: 'v1', name: 'Valve', kind: 'valve' },
    { id: 'fs1', name: 'Flow', kind: 'flow_sensor' },
  ];
  const results = pumpUniqRule.evaluate([], noPumps);
  assert(results.length === 0, 'No pumps at all: no error');
}

// ---------------------------------------------------------------------------
// Entity constraints — filter
// ---------------------------------------------------------------------------

console.log('\nEntity constraints — filter:');

{
  const constraints = filterDescriptor.constraints!;
  assert(constraints.length === 1, 'Filter has one constraint');
  const c = constraints[0];
  assert(c.type === 'presence', 'Constraint type is presence');
  assert(c.id === 'filter-upstream-valve', 'Constraint id is filter-upstream-valve');
  assert(c.requiredKind === 'valve', 'Requires a valve');
  assert(c.position === 'upstream', 'Position is upstream');
  assert(c.baseSeverity === 'error', 'Severity is error');
}

// ---------------------------------------------------------------------------
// Entity constraints — dosing pump
// ---------------------------------------------------------------------------

console.log('\nEntity constraints — dosing pump:');

{
  const constraints = dosingPumpDescriptor.constraints!;
  assert(constraints.length === 1, 'Dosing pump has one constraint');
  const c = constraints[0];
  assert(c.type === 'presence', 'Constraint type is presence');
  assert(c.id === 'dosing-downstream-flow', 'Constraint id is dosing-downstream-flow');
  assert(c.requiredKind === 'flow_sensor', 'Requires a flow_sensor');
  assert(c.position === 'downstream', 'Position is downstream');
  assert(c.baseSeverity === 'warning', 'Severity is warning');
}

// ---------------------------------------------------------------------------
// Descriptor flags — dosing pump should NOT have isPump
// ---------------------------------------------------------------------------

console.log('\nDescriptor flags:');

{
  assert(dosingPumpDescriptor.isPump === undefined, 'Dosing pump does not have isPump');
  assert(dosingPumpDescriptor.conflictClass === 'actuator', 'Dosing pump conflictClass is actuator');
  assert(dosingPumpDescriptor.experimental === true, 'Dosing pump is experimental');
  assert(filterDescriptor.experimental === true, 'Filter is experimental');
}

// ---------------------------------------------------------------------------
// All entities have constraints or are terminal/infrastructure
// ---------------------------------------------------------------------------

console.log('\nAll entities declare constraints or are terminal/infrastructure:');

{
  for (const [kind, desc] of NODE_REGISTRY) {
    const hasConstraints = desc.constraints && desc.constraints.length > 0;
    const isTerminal = desc.role === 'terminal';
    // Entities without constraints should be terminal, constraint-targets, or pump-class (VFD inherits pump's route context)
    const isConstraintTarget = kind === 'valve' || kind === 'flow_sensor';
    const isPumpClass = !!desc.isPump;
    assert(
      hasConstraints || isTerminal || isConstraintTarget || isPumpClass,
      `${kind}: has constraints (${!!hasConstraints}), terminal (${isTerminal}), constraint-target (${isConstraintTarget}), or pump-class (${isPumpClass})`,
    );
  }
}

// ---------------------------------------------------------------------------

console.log(`\n${'='.repeat(40)}`);
console.log(`${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
