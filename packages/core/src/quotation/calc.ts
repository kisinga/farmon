/**
 * Quotation calculation logic.
 *
 * Pure, composable functions. No side effects.
 */

import type { CatalogItem, CatalogItemSpecs, Quotation, QuotationInput, QuotationLineItem } from './types';
import { findDefaultCatalogItem } from './catalog';

/** Generate a short quote ID: Q-YYYYMMDD-XXXX */
function generateQuoteId(): string {
  const now = new Date();
  const date = now.toISOString().slice(0, 10).replace(/-/g, '');
  const rand = Math.floor(Math.random() * 10000).toString().padStart(4, '0');
  return `Q-${date}-${rand}`;
}

/** Default markup multiplier (cost → price). */
const DEFAULT_MARKUP = 1.3;

function makeLineItem(
  item: CatalogItem,
  quantity: number,
  markup: number = DEFAULT_MARKUP,
  notes?: string,
): QuotationLineItem {
  const unitPrice = Math.round(item.unitCostUsd * markup * 100) / 100;
  return {
    catalogItemId: item.id,
    name: item.name,
    manufacturer: item.manufacturer,
    specs: item.specs,
    description: item.description,
    quantity,
    unitCost: item.unitCostUsd,
    unitPrice,
    lineTotal: Math.round(unitPrice * quantity * 100) / 100,
    selectionHelp: item.selectionHelp,
    notes,
  };
}

function sumLineItems(items: QuotationLineItem[]): number {
  return Math.round(items.reduce((sum, i) => sum + i.lineTotal, 0) * 100) / 100;
}

// ---------------------------------------------------------------------------
// Base Infrastructure
// ---------------------------------------------------------------------------

export function buildBaseInfrastructure(
  hasVfd: boolean,
  catalog: CatalogItem[],
  opts?: { cableLengthMeters?: number },
): QuotationLineItem[] {
  const items: QuotationLineItem[] = [];

  const add = (category: CatalogItem['category'], subCategory: string | undefined, specMatch: Partial<CatalogItemSpecs>, qty: number, notes?: string) => {
    const found = findDefaultCatalogItem(catalog, category, subCategory, specMatch);
    if (!found) return;
    items.push(makeLineItem(found, qty, DEFAULT_MARKUP, notes));
  };

  // Always present
  add('controller', 'esp32_relay_board', {}, 1, 'Main controller');
  add('base_infra', 'single_board_computer', {}, 1, 'Home Assistant OS host');
  add('power', 'ups', {}, 1, 'Battery backup for controller and Pi');
  add('power', 'solar', {}, 1, 'Keeps UPS charged, reduces running costs');
  add('enclosure', 'din_rail', {}, 1, 'Houses all electronics');

  // Relay only if NOT using VFD
  if (!hasVfd) {
    add('relay', 'high_current_relay', {}, 1, 'Pump switching (omitted for VFD installs)');
  }

  // Cabling — rough estimate based on valve count + sensor count
  const cableLength = opts?.cableLengthMeters ?? 50;
  add('base_infra', 'cable', { gauge: '1.0mm²' }, cableLength, 'Valve actuator wiring (~10-20m per valve)');
  add('base_infra', 'cable', { gauge: '0.34mm²' }, Math.round(cableLength * 0.6), 'Sensor signal wiring (~5-15m per sensor)');

  return items;
}

// ---------------------------------------------------------------------------
// Topology Components (from questionnaire counts)
// ---------------------------------------------------------------------------

export function buildTopologyComponents(
  input: QuotationInput,
  catalog: CatalogItem[],
): QuotationLineItem[] {
  const items: QuotationLineItem[] = [];

  const add = (category: CatalogItem['category'], subCategory: string | undefined, specMatch: Partial<CatalogItemSpecs>, qty: number, notes?: string) => {
    const found = findDefaultCatalogItem(catalog, category, subCategory, specMatch);
    if (!found) return;
    items.push(makeLineItem(found, qty, DEFAULT_MARKUP, notes));
  };

  // Valves — one per zone, sized by pipe diameter
  if (input.numValveZones > 0) {
    add('valve', 'ball_valve', { portSize: input.maxPipeDiameter }, input.numValveZones);
  }

  // Flow sensors
  if (input.numFlowSensors > 0) {
    add('flow_sensor', 'pulse_flow', { portSize: input.maxPipeDiameter }, input.numFlowSensors);
  }

  return items;
}

// ---------------------------------------------------------------------------
// Full Quotation Assembly
// ---------------------------------------------------------------------------

export function buildQuotation(
  input: QuotationInput,
  catalog: CatalogItem[],
  opts?: { customerName?: string; siteName?: string; cableLengthMeters?: number },
): Quotation {
  const base = buildBaseInfrastructure(input.hasVfd, catalog, opts);
  const topology = buildTopologyComponents(input, catalog);
  const all = [...base, ...topology];

  return {
    quoteId: generateQuoteId(),
    generatedAt: new Date().toISOString(),
    customerName: opts?.customerName,
    siteName: opts?.siteName,
    baseInfrastructure: base,
    systemComponents: topology,
    subtotal: sumLineItems(all),
    currency: 'KES',
  };
}

// ---------------------------------------------------------------------------
// Topology-driven generation (for desktop app)
// ---------------------------------------------------------------------------

import type { SiteTopology, TopologyNode } from '../topology.types';

function countByKind(nodes: TopologyNode[], kind: TopologyNode['kind']): number {
  return nodes.filter((n) => n.kind === kind).length;
}

export function buildQuotationFromTopology(
  topology: SiteTopology,
  catalog: CatalogItem[],
  opts?: { customerName?: string; siteName?: string; cableLengthMeters?: number },
): Quotation {
  const hasVfd = countByKind(topology.nodes, 'vfd') > 0;
  const numValveZones = countByKind(topology.nodes, 'valve');
  const numFlowSensors = countByKind(topology.nodes, 'flow_sensor');

  // Infer pipe diameter from the largest valve spec if available, else default DN20
  let maxPipeDiameter: QuotationInput['maxPipeDiameter'] = 'DN20';
  // Future: valves may carry a portSize property; for now default to DN20
  // and let the user override in the desktop app.

  const input: QuotationInput = {
    numTanks: countByKind(topology.nodes, 'tank'),
    numPumps: countByKind(topology.nodes, 'pump') + countByKind(topology.nodes, 'vfd'),
    hasVfd,
    numValveZones,
    maxPipeDiameter,
    numFlowSensors,
    customerName: opts?.customerName,
  };

  return buildQuotation(input, catalog, opts);
}
