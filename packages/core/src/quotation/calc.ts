/**
 * Quotation calculation logic.
 *
 * Pure, composable functions. No side effects.
 */

import type { ProductLine, ProductVariant, Quotation, QuotationDiagnostic, QuotationInput, QuotationLineItem } from './types';
import type { CatalogBundle } from './catalog';
import { resolveQuoteLineItem } from './catalog';

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
  line: ProductLine,
  variant: ProductVariant,
  quantity: number,
  markup: number = DEFAULT_MARKUP,
  notes?: string,
): QuotationLineItem {
  const unitPrice = Math.round(variant.unitCost * markup * 100) / 100;
  return {
    manufacturerId: line.id,
    name: line.name,
    manufacturer: line.manufacturer,
    specs: { ...line.baseSpecs, ...variant.params },
    description: line.description,
    quantity,
    unitCost: variant.unitCost,
    unitPrice,
    lineTotal: Math.round(unitPrice * quantity * 100) / 100,
    currency: variant.currency,
    selectionHelp: line.selectionHelp,
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
  bundle: CatalogBundle,
  opts?: { cableLengthMeters?: number; componentParams?: Record<string, Record<string, string>>; diagnostics?: QuotationDiagnostic[] },
): QuotationLineItem[] {
  const items: QuotationLineItem[] = [];

  const add = (componentId: string, paramOverrides: Record<string, string> = {}, qty: number, notes?: string) => {
    const resolved = resolveQuoteLineItem(componentId, paramOverrides, bundle);
    if (!resolved) {
      opts?.diagnostics?.push({
        componentId,
        reason: `No active variant found for params ${JSON.stringify(paramOverrides)}`,
      });
      return;
    }
    items.push(makeLineItem(resolved.line, resolved.variant, qty, DEFAULT_MARKUP, notes));
  };

  add('controller', {}, 1, 'Main controller');
  add('compute', {}, 1, 'Home Assistant OS host');
  add('power_ups', {}, 1, 'Battery backup for controller and Pi');
  add('power_solar', {}, 1, 'Keeps UPS charged, reduces running costs');
  add('enclosure', {}, 1, 'Houses all electronics');

  if (!hasVfd) {
    add('relay', {}, 1, 'Pump switching (omitted for VFD installs)');
  }

  const cableLength = opts?.cableLengthMeters ?? 50;
  add('cable_valve', opts?.componentParams?.['cable_valve'] ?? {}, cableLength, 'Valve actuator wiring (~10-20m per valve)');
  add('cable_sensor', opts?.componentParams?.['cable_sensor'] ?? {}, Math.round(cableLength * 0.6), 'Sensor signal wiring (~5-15m per sensor)');

  return items;
}

// ---------------------------------------------------------------------------
// Topology Components (from questionnaire counts)
// ---------------------------------------------------------------------------

export function buildTopologyComponents(
  input: QuotationInput,
  bundle: CatalogBundle,
  opts?: { diagnostics?: QuotationDiagnostic[] },
): QuotationLineItem[] {
  const items: QuotationLineItem[] = [];

  const add = (componentId: string, paramOverrides: Record<string, string> = {}, qty: number, notes?: string) => {
    const resolved = resolveQuoteLineItem(componentId, paramOverrides, bundle);
    if (!resolved) {
      opts?.diagnostics?.push({
        componentId,
        reason: `No active variant found for params ${JSON.stringify(paramOverrides)}`,
      });
      return;
    }
    items.push(makeLineItem(resolved.line, resolved.variant, qty, DEFAULT_MARKUP, notes));
  };

  const valveParams = input.componentParams?.['valve'] ?? { portSize: input.maxPipeDiameter };
  const flowParams = input.componentParams?.['flow_sensor'] ?? { portSize: input.maxPipeDiameter };

  if (input.numValveZones > 0) {
    add('valve', valveParams, input.numValveZones);
  }

  if (input.numFlowSensors > 0) {
    add('flow_sensor', flowParams, input.numFlowSensors);
  }

  return items;
}

// ---------------------------------------------------------------------------
// Full Quotation Assembly
// ---------------------------------------------------------------------------

export function buildQuotation(
  input: QuotationInput,
  bundle: CatalogBundle,
  opts?: { customerName?: string; siteName?: string; cableLengthMeters?: number; diagnostics?: QuotationDiagnostic[] },
): Quotation {
  const diagnostics = opts?.diagnostics;
  const base = buildBaseInfrastructure(input.hasVfd, bundle, { cableLengthMeters: opts?.cableLengthMeters, componentParams: input.componentParams, diagnostics });
  const topology = buildTopologyComponents(input, bundle, { diagnostics });
  const all = [...base, ...topology];

  return {
    quoteId: generateQuoteId(),
    generatedAt: new Date().toISOString(),
    customerName: opts?.customerName,
    siteName: opts?.siteName,
    baseInfrastructure: base,
    systemComponents: topology,
    subtotal: sumLineItems(all),
    currency: 'USD',
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
  bundle: CatalogBundle,
  opts?: { customerName?: string; siteName?: string; cableLengthMeters?: number; componentParams?: Record<string, Record<string, string>>; diagnostics?: QuotationDiagnostic[] },
): Quotation {
  const hasVfd = countByKind(topology.nodes, 'vfd') > 0;
  const numValveZones = countByKind(topology.nodes, 'valve');
  const numFlowSensors = countByKind(topology.nodes, 'flow_sensor');

  let maxPipeDiameter: QuotationInput['maxPipeDiameter'] = 'DN20';

  const input: QuotationInput = {
    numTanks: countByKind(topology.nodes, 'tank'),
    numPumps: countByKind(topology.nodes, 'pump') + countByKind(topology.nodes, 'vfd'),
    hasVfd,
    numValveZones,
    maxPipeDiameter,
    numFlowSensors,
    componentParams: opts?.componentParams,
    customerName: opts?.customerName,
  };

  return buildQuotation(input, bundle, opts);
}
