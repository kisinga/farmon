/**
 * Documentation variable vocabulary + resolvers.
 *
 * Docs are authored as markdown with `{{slot}}` placeholders. A slot resolves to
 * a live value pulled from the same `@core` domain data the firmware generator
 * reads, so a rendered doc can never show a number the device isn't running.
 *
 * Three scopes, keyed by what a doc is attached to:
 *   - narrative → site values only
 *   - board     → board values + site values
 *   - node      → node-kind values + site values
 *
 * Each scope's vocabulary IS the keys of its resolver table — one source for both
 * "which slots exist" (the drift guard in validate.ts) and "how they resolve".
 */
import type { SiteTopology, TopologyNode } from '../topology.types';
import { getNodesByKind } from '../topology.types';
import type { BoardDef } from '../board.types';
import { boardSupportedTransports, pinsWithCap } from '../board.types';
import { NODE_REGISTRY } from '../entity-registry';

type Scalar = string | number;

/** Context for site-scope variables (whole-site facts). */
export interface SiteVarCtx {
  siteName: string;
  topo: SiteTopology;
  /** Route count — the assembler already derives routes, so it passes the count. */
  routeCount: number;
  /** Commissioning date for display ('Not yet commissioned' before first connect). */
  commissionDate: string;
  /** Warranty expiry for display ('Begins at commissioning' before first connect). */
  warrantyExpiry: string;
}

/** Context for node-scope variables (per node KIND, not per instance). */
export interface NodeVarCtx {
  kind: TopologyNode['kind'];
  topo: SiteTopology;
}

/** Site-scope resolver table. Its keys are the narrative vocabulary. */
const SITE_VARS: Record<string, (c: SiteVarCtx) => Scalar> = {
  site_name:         c => c.siteName,
  controller_count:  c => c.topo.controllers.length,
  tank_count:        c => getNodesByKind(c.topo, 'tank').length,
  pump_count:        c => getNodesByKind(c.topo, 'pump').length,
  valve_count:       c => getNodesByKind(c.topo, 'valve').length,
  flow_sensor_count: c => getNodesByKind(c.topo, 'flow_sensor').length,
  route_count:       c => c.routeCount,
  flow_watchdog:     c => c.topo.timing.flow_watchdog,
  flow_confirm:      c => c.topo.timing.flow_confirm,
  flow_threshold:    c => c.topo.timing.flow_threshold,
  valve_travel_time: c => c.topo.timing.valve_travel_time,
  update_interval:   c => c.topo.timing.update_interval,
  commission_date:   c => c.commissionDate,
  warranty_expiry:   c => c.warrantyExpiry,
};

const yesno = (v: unknown): string => (v ? 'yes' : 'no');

/** Board-scope resolver table (board-specific slots; site slots also apply). */
const BOARD_VARS: Record<string, (b: BoardDef) => Scalar> = {
  board_model:       b => b.model,
  board_label:       b => b.label,
  mcu_variant:       b => b.mcu.variant,
  flash_size:        b => b.mcu.flash_size,
  framework:         b => b.mcu.framework,
  pin_count:         b => b.pins.length,
  digital_pin_count: b => pinsWithCap(b, 'digital').size,
  adc_pin_count:     b => pinsWithCap(b, 'adc').size,
  transports:        b => boardSupportedTransports(b).join(', '),
  has_ethernet:      b => yesno(b.peripherals.ethernet),
  has_oled:          b => yesno(b.peripherals.oled),
  has_lora:          b => yesno(b.peripherals.lora),
  has_battery:       b => yesno(b.peripherals.battery),
  expander_count:    b => b.expanders?.length ?? 0,
  uart_count:        b => b.uart_buses?.length ?? 0,
};

/** Node-scope resolver table (node-kind slots; site slots also apply). */
const NODE_VARS: Record<string, (c: NodeVarCtx) => Scalar> = {
  node_kind:       c => c.kind,
  node_kind_label: c => NODE_REGISTRY.get(c.kind)?.label ?? c.kind,
  node_kind_count: c => getNodesByKind(c.topo, c.kind).length,
};

export type DocScope = 'narrative' | 'board' | 'node';

function resolveTable<C>(table: Record<string, (c: C) => Scalar>, ctx: C): Record<string, Scalar> {
  const out: Record<string, Scalar> = {};
  for (const key of Object.keys(table)) out[key] = table[key](ctx);
  return out;
}

/** Resolve site-scope values. */
export function siteVars(ctx: SiteVarCtx): Record<string, Scalar> {
  return resolveTable(SITE_VARS, ctx);
}

/** Resolve board-scope values (board slots only — merge with {@link siteVars}). */
export function boardVars(board: BoardDef): Record<string, Scalar> {
  return resolveTable(BOARD_VARS, board);
}

/** Resolve node-scope values (node slots only — merge with {@link siteVars}). */
export function nodeVars(ctx: NodeVarCtx): Record<string, Scalar> {
  return resolveTable(NODE_VARS, ctx);
}

/** The declared slot vocabulary for a scope — the drift guard's source of truth. */
export function vocabFor(scope: DocScope): string[] {
  const site = Object.keys(SITE_VARS);
  switch (scope) {
    case 'narrative': return site;
    case 'board':     return [...site, ...Object.keys(BOARD_VARS)];
    case 'node':      return [...site, ...Object.keys(NODE_VARS)];
  }
}
