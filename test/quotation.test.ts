/**
 * Tests for the quotation / BOM calculation module.
 *
 * Usage: npx tsx test/quotation.test.ts
 */

import {
  DEFAULT_CATALOG,
  findDefaultCatalogItem,
  buildBaseInfrastructure,
  buildTopologyComponents,
  buildQuotation,
  buildQuotationFromTopology,
  renderQuotationHtml,
  renderTechnicalBomHtml,
} from '../packages/core/src/quotation/index.js';
import type { QuotationInput, CatalogItem } from '../packages/core/src/quotation/index.js';

let passed = 0;
let failed = 0;

function assert(condition: boolean, name: string, detail?: string) {
  if (condition) {
    console.log(`  \u2713 ${name}`);
    passed++;
  } else {
    console.log(`  \u2717 ${name}${detail ? ` \u2014 ${detail}` : ""}`);
    failed++;
  }
}

function assertEq(actual: unknown, expected: unknown, name: string) {
  const match = JSON.stringify(actual) === JSON.stringify(expected);
  assert(match, name, match ? undefined : `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

// ---------------------------------------------------------------------------
// Catalog
// ---------------------------------------------------------------------------

console.log('\nCatalog');

assert(DEFAULT_CATALOG.length > 0, 'default catalog is not empty');
assert(
  DEFAULT_CATALOG.some((c) => c.category === 'valve' && c.specs.portSize === 'DN20'),
  'catalog has DN20 valves',
);
assert(
  DEFAULT_CATALOG.some((c) => c.category === 'flow_sensor' && c.specs.portSize === 'DN20'),
  'catalog has DN20 flow sensors',
);

const dn20Valve = findDefaultCatalogItem(DEFAULT_CATALOG, 'valve', 'ball_valve', { portSize: 'DN20' });
assert(dn20Valve !== undefined, 'findDefaultCatalogItem finds DN20 valve');
assertEq(dn20Valve?.specs.portSize, 'DN20', 'DN20 valve has correct port size');

const missing = findDefaultCatalogItem(DEFAULT_CATALOG, 'valve', 'ball_valve', { portSize: 'DN100' });
assert(missing === undefined, 'findDefaultCatalogItem returns undefined for missing spec');

// ---------------------------------------------------------------------------
// Base Infrastructure
// ---------------------------------------------------------------------------

console.log('\nBase Infrastructure');

const baseNoVfd = buildBaseInfrastructure(false, DEFAULT_CATALOG);
const baseWithVfd = buildBaseInfrastructure(true, DEFAULT_CATALOG);

assert(baseNoVfd.length > 0, 'base infrastructure has items (no VFD)');
assert(baseWithVfd.length > 0, 'base infrastructure has items (with VFD)');

const hasRelayNoVfd = baseNoVfd.some((i) => i.catalogItemId === 'relay-30a-module');
const hasRelayVfd = baseWithVfd.some((i) => i.catalogItemId === 'relay-30a-module');

assert(hasRelayNoVfd, 'base includes 30A relay when no VFD');
assert(!hasRelayVfd, 'base omits 30A relay when VFD present');

assert(
  baseNoVfd.some((i) => i.catalogItemId === 'ctrl-kc868-a16'),
  'base includes KC868 controller',
);
assert(
  baseNoVfd.some((i) => i.catalogItemId === 'compute-rpi-3bp'),
  'base includes Raspberry Pi',
);
assert(
  baseNoVfd.some((i) => i.catalogItemId === 'power-solar-kit'),
  'base includes solar kit',
);

// Pricing check
const piItem = baseNoVfd.find((i) => i.catalogItemId === 'compute-rpi-3bp');
assert(piItem !== undefined, 'Pi item exists');
assert(piItem!.unitPrice > piItem!.unitCost, 'Pi has markup applied');
assertEq(piItem!.quantity, 1, 'Pi quantity is 1');

// ---------------------------------------------------------------------------
// Topology Components
// ---------------------------------------------------------------------------

console.log('\nTopology Components');

const input: QuotationInput = {
  numTanks: 2,
  numPumps: 1,
  hasVfd: false,
  numValveZones: 4,
  maxPipeDiameter: 'DN20',
  numFlowSensors: 3,
};

const topo = buildTopologyComponents(input, DEFAULT_CATALOG);
assert(topo.length > 0, 'topology components has items');

const valves = topo.filter((i) => i.catalogItemId.startsWith('valve-'));
const sensors = topo.filter((i) => i.catalogItemId.startsWith('flow-'));

assertEq(valves.length, 1, 'single valve line item (grouped by size)');
assertEq(valves[0]?.quantity, 4, 'valve quantity matches numValveZones');
assertEq(sensors.length, 1, 'single flow sensor line item');
assertEq(sensors[0]?.quantity, 3, 'flow sensor quantity matches numFlowSensors');
assert(valves[0]?.specs.portSize === 'DN20', 'valves are DN20');
assert(sensors[0]?.specs.portSize === 'DN20', 'flow sensors are DN20');

// ---------------------------------------------------------------------------
// Full Quotation
// ---------------------------------------------------------------------------

console.log('\nFull Quotation');

const quote = buildQuotation(input, DEFAULT_CATALOG, { customerName: 'Test Customer' });

assert(quote.quoteId.startsWith('Q-'), 'quote ID starts with Q-');
assert(quote.customerName === 'Test Customer', 'customer name preserved');
assert(quote.baseInfrastructure.length > 0, 'quote has base infrastructure');
assert(quote.systemComponents.length > 0, 'quote has system components');
assert(quote.subtotal > 0, 'subtotal is positive');
assert(quote.currency === 'KES', 'currency is KES');

// Verify subtotal math
const expectedSubtotal = [...quote.baseInfrastructure, ...quote.systemComponents]
  .reduce((s, i) => s + i.lineTotal, 0);
assert(
  Math.abs(quote.subtotal - expectedSubtotal) < 0.01,
  'subtotal matches sum of line items',
);

// ---------------------------------------------------------------------------
// HTML Rendering
// ---------------------------------------------------------------------------

console.log('\nHTML Rendering');

const htmlWithPrice = renderQuotationHtml(quote, { showPricing: true });
const htmlWithoutPrice = renderTechnicalBomHtml(quote);

assert(htmlWithPrice.includes('<!DOCTYPE html>'), 'HTML has doctype');
assert(htmlWithPrice.includes('MajiFlow Quotation'), 'HTML has title');
assert(htmlWithPrice.includes(quote.quoteId), 'HTML contains quote ID');
assert(htmlWithPrice.includes('Base Infrastructure'), 'HTML has base section');
assert(htmlWithPrice.includes('System Components'), 'HTML has topology section');
assert(htmlWithPrice.includes('KSh'), 'priced HTML contains KSh');
assert(!htmlWithoutPrice.includes('$'), 'technical BOM omits pricing');
assert(htmlWithPrice.includes('Test Customer'), 'HTML contains customer name');

// ---------------------------------------------------------------------------
// Topology-driven generation
// ---------------------------------------------------------------------------

console.log('\nTopology-driven Quotation');

const minimalTopology = {
  schema: 16 as const,
  controllers: [{ id: 'ctrl-1', board: 'kc868-a16' }],
  nodes: [
    { kind: 'tank' as const, id: 't1', name: 'Tank 1', ports: [], position: { x: 0, y: 0 }, anchorId: 'ctrl-1' },
    { kind: 'valve' as const, id: 'v1', name: 'Valve 1', ports: [], position: { x: 0, y: 0 }, anchorId: 'ctrl-1', open_pin: 'GPIO2', close_pin: 'GPIO3' },
    { kind: 'valve' as const, id: 'v2', name: 'Valve 2', ports: [], position: { x: 0, y: 0 }, anchorId: 'ctrl-1', open_pin: 'GPIO4', close_pin: 'GPIO5' },
    { kind: 'flow_sensor' as const, id: 'f1', name: 'Flow 1', ports: [], position: { x: 0, y: 0 }, anchorId: 'ctrl-1', pin: 'GPIO32' },
  ],
  pipes: [],
  route_overrides: {},
  timing: { valve_travel_time: 15, flow_watchdog: 30, flow_confirm: 10, flow_threshold: 0.5, api_watchdog: 60, update_interval: 30 },
  automations: [],
  remoteImports: [],
};

const topoQuote = buildQuotationFromTopology(minimalTopology, DEFAULT_CATALOG);
assert(topoQuote.systemComponents.some((i) => i.catalogItemId.startsWith('valve-')), 'topology quote has valves');
assert(topoQuote.systemComponents.some((i) => i.catalogItemId.startsWith('flow-')), 'topology quote has flow sensors');
assert(
  topoQuote.baseInfrastructure.some((i) => i.catalogItemId === 'relay-30a-module'),
  'topology quote includes relay (no VFD)',
);

// With VFD
const vfdTopology = {
  ...minimalTopology,
  nodes: [
    ...minimalTopology.nodes,
    { kind: 'vfd' as const, id: 'vfd1', name: 'VFD Pump', ports: [], position: { x: 0, y: 0 }, anchorId: 'ctrl-1', start_register: 0, speed_register: 1, modbus_address: 1 },
  ],
};
const vfdQuote = buildQuotationFromTopology(vfdTopology, DEFAULT_CATALOG);
assert(
  !vfdQuote.baseInfrastructure.some((i) => i.catalogItemId === 'relay-30a-module'),
  'VFD topology omits relay',
);

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
