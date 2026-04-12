/**
 * Entity registry — single source of truth for node descriptors.
 * Each entity self-registers by calling NODE_REGISTRY.set().
 *
 * Every entity is fully self-describing: UI (renderSvg, sidebarFields),
 * schema (Zod), codegen (ESPHome YAML templates), and validation rules
 * are all co-located in a single entity file.
 */

import type { z } from 'zod';
import type { PinCap } from './board.types';
import type { FlowConstraint } from './graph/constraints';

// ---------------------------------------------------------------------------
// Field definition (drives sidebar forms)
// ---------------------------------------------------------------------------

export interface FieldDef {
  key: string;
  label: string;
  type: 'text' | 'number' | 'pin' | 'toggle';
  placeholder?: string;
  /** Pin capability required for this field, e.g. 'adc'. Filters pin selection and drives validation. */
  pinCap?: PinCap;
}

// ---------------------------------------------------------------------------
// Codegen — ESPHome YAML/C++ fragment generators per entity kind
// ---------------------------------------------------------------------------

/**
 * Context passed to codegen functions. Provides pin resolution and
 * other board-aware utilities without coupling entities to BoardDef.
 */
export interface CodegenContext {
  /** Resolve a pin name to an ESPHome YAML pin block (indented for use inside `pin:`). */
  resolvePin: (pin: string, opts?: { inverted?: boolean; mode?: string }) => string;
}

export interface EntityCodegen<T extends Record<string, any> = Record<string, any>> {
  /** YAML fragment for sensors.yaml sensor: section (ADC, pulse counter, template sensors). */
  sensors?: (node: T, index: number, ctx?: CodegenContext) => string;
  /** YAML fragment for hardware.yaml switch: section (switches, relays). */
  hardware?: (node: T, index: number, ctx?: CodegenContext) => string;
  /** Substitution lines for device.yaml (non-pin substitutions only). */
  substitutions?: (node: T) => string[];
  /** Additional globals for control.yaml. */
  globals?: (node: T) => string;
  /**
   * Additional ESPHome component blocks keyed by YAML section name.
   * e.g. { number: "- platform: ...", cover: "- platform: ...", button: "- platform: ..." }
   * Each value is a YAML fragment (indented with 2 spaces) appended to that section.
   */
  extraComponents?: (node: T, index: number, ctx?: CodegenContext) => Record<string, string>;
}

// ---------------------------------------------------------------------------
// Validation — per-entity topology rules
// ---------------------------------------------------------------------------

export interface EntityRule {
  id: string;
  severity: 'error' | 'warning';
  /** Evaluate this rule against nodes of this kind. */
  evaluate: (
    kindNodes: Record<string, any>[],
    allNodes: Record<string, any>[],
  ) => Array<{ message: string; target?: string }>;
}

// ---------------------------------------------------------------------------
// Node descriptor
// ---------------------------------------------------------------------------

export interface NodeDescriptor {
  kind: string;
  label: string;
  color: string;
  size: { width: number; height: number };
  singleton?: boolean;
  role: 'terminal' | 'passthrough';
  routeSource?: boolean;
  /** Category for grouping in add-node menu. */
  category?: 'source' | 'actuator' | 'sensor' | 'destination' | 'infrastructure' | 'boundary';
  /** UI grouping key (e.g. 'pump' groups relay pump + dosing pump). Falls back to category. */
  group?: string;
  /** When true, shows experimental badge and marks codegen output. */
  experimental?: boolean;
  /** URL to installation/usage docs for this entity type. */
  helpUrl?: string;
  defaultPorts: Array<{ id: string; label: string; direction: 'inlet' | 'outlet' }>;
  defaultData: (index: number) => Record<string, any>;
  /** Returns a raw SVG string for the canvas element. Receives full node data. */
  renderSvg: (data: Record<string, any>) => string;
  /** Optional fixed port y-positions keyed by port id. Used for entities like tanks where inlet/outlet height matters. */
  portLayout?: Record<string, { y: number }>;
  sidebarFields: FieldDef[];

  /** Zod schema for this node kind. Source of truth for the TypeScript type. */
  schema: z.ZodTypeAny;

  /** Codegen templates — only consumed by electron generators. */
  codegen?: EntityCodegen<any>;

  /** Per-entity validation rules — only consumed by electron rule runner. */
  rules?: EntityRule[];

  /** Flow constraints this entity declares on routes it appears in. */
  constraints?: FlowConstraint[];

  // --- Dispatch flags — tell the graph layer and generators what this entity does ---

  /** Acts as a pump — participates in pump refcounting. */
  isPump?: boolean;
  /** Acts as a valve — included in route valve masks and dispatch. */
  isValve?: boolean;
  /** Acts as a flow sensor — required for valid routes, flow dispatch. */
  isFlowSensor?: boolean;
  /** Acts as a level sensor — included in level dispatch. */
  isLevelSensor?: boolean;
  /** Acts as a pressure sensor — included in pressure dispatch and route analysis. */
  isPressureSensor?: boolean;
  /** Conflict class: 'sensor' readings are ambiguous when shared, 'actuator' access is refcountable. */
  conflictClass?: 'sensor' | 'actuator';
}

// ---------------------------------------------------------------------------
// Legend SVG — derived from renderSvg, scaled to fit menu/legend contexts
// ---------------------------------------------------------------------------

const LEGEND_H = 16;

export function legendSvgFor(desc: NodeDescriptor): string {
  const { width, height } = desc.size;
  const w = Math.round(width * (LEGEND_H / height));
  const svg = desc.renderSvg(desc.defaultData(1));
  const inner = svg.replace(/^<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '').replace(/<text[^>]*>.*?<\/text>/g, '');
  return `<svg width="${w}" height="${LEGEND_H}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">${inner}</svg>`;
}

// ---------------------------------------------------------------------------
// Registry — explicit composition, no side-effect imports
// ---------------------------------------------------------------------------

import { tankDescriptor } from './entities/tank';
import { pumpDescriptor } from './entities/pump';
import { endpointDescriptor } from './entities/endpoint';
import { valveDescriptor } from './entities/valve';
import { flowSensorDescriptor } from './entities/flow-sensor';
import { waterSourceDescriptor } from './entities/water-source';
import { pressureSensorDescriptor } from './entities/pressure-sensor';
import { filterDescriptor } from './entities/filter';
import { dosingPumpDescriptor } from './entities/dosing-pump';
import { vfdDescriptor } from './entities/vfd';
import { interconnectDescriptor } from './entities/interconnect';

export const ALL_DESCRIPTORS: readonly NodeDescriptor[] = [
  tankDescriptor,
  pumpDescriptor,
  endpointDescriptor,
  valveDescriptor,
  flowSensorDescriptor,
  waterSourceDescriptor,
  pressureSensorDescriptor,
  filterDescriptor,
  dosingPumpDescriptor,
  vfdDescriptor,
  interconnectDescriptor,
];

export const NODE_REGISTRY: ReadonlyMap<string, NodeDescriptor> = new Map(
  ALL_DESCRIPTORS.map(d => [d.kind, d]),
);

// ---------------------------------------------------------------------------
// Registry-level rules — cross-cutting validation derived from descriptors
// ---------------------------------------------------------------------------

/**
 * Shared rule: warns when experimental nodes without codegen are present.
 * Applies across all node kinds — not tied to a single entity.
 */
export const REGISTRY_RULES: readonly EntityRule[] = [
  {
    id: 'experimental-no-codegen',
    severity: 'warning',
    evaluate: (_kindNodes, allNodes) => {
      return allNodes
        .filter(n => {
          const desc = NODE_REGISTRY.get(n['kind']);
          return desc?.experimental && !desc.codegen;
        })
        .map(n => ({
          message: `"${n['name'] ?? n['id']}" is experimental and will not generate hardware configuration.`,
          target: String(n['id']),
        }));
    },
  },
  {
    id: 'pump-id-uniqueness',
    severity: 'error',
    evaluate: (_kind, allNodes) => {
      const pumpNodes = allNodes.filter(n => NODE_REGISTRY.get(n['kind'])?.isPump);
      if (pumpNodes.length <= 1) return [];
      // Multiple pump-flagged nodes share the same pumpSwitchId — conflict
      return pumpNodes.slice(1).map(n => ({
        message: `Multiple pump entities found. "${n['name'] ?? n['id']}" conflicts with an existing pump — only one pump-class node is supported per device.`,
        target: String(n['id']),
      }));
    },
  },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type DispatchFlag = 'isPump' | 'isValve' | 'isFlowSensor' | 'isLevelSensor' | 'isPressureSensor';

/**
 * Type-safe descriptor accessor — narrows to a specific entity's data shape.
 * Use when the kind is known and you need typed access to renderSvg, defaultData, or codegen.
 * Generic iteration should continue using the untyped NODE_REGISTRY.
 */
export type TypedDescriptor<T extends Record<string, any>> =
  NodeDescriptor & { renderSvg: (data: T) => string; defaultData: (i: number) => T; codegen?: EntityCodegen<T> };

export function getTypedDescriptor<T extends Record<string, any>>(
  kind: string,
): TypedDescriptor<T> | undefined {
  return NODE_REGISTRY.get(kind) as TypedDescriptor<T> | undefined;
}

/** Filter manifest nodes by a descriptor dispatch flag. */
export function nodesWithFlag(
  nodes: Array<{ kind: string; [k: string]: any }>,
  flag: DispatchFlag,
): Array<{ kind: string; [k: string]: any }> {
  return nodes.filter(n => NODE_REGISTRY.get(n.kind)?.[flag]);
}
