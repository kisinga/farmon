/**
 * Entity registry — single source of truth for node descriptors.
 * Each entity self-registers by calling NODE_REGISTRY.set().
 *
 * Every entity is fully self-describing: UI (renderSvg, sidebarFields),
 * schema (Zod), codegen (ESPHome YAML templates), and validation rules
 * are all co-located in a single entity file.
 */

import type { z } from 'zod';
import type { ChannelUsage, ResolvedChannel } from './io-provider.types';
import type { PinCap } from './board.types';
import type { FlowConstraint } from './graph/constraints';
import type { TopologyGraph } from './graph/topology-graph';
import type { Route } from './graph/routes';
import type { RuleDiagnostic } from './validation.types';
import type { HaActionSpec, HaSlotSpec } from './ha';
import type { InputPolicy } from './input-policy';
import type { TopologyNode } from './topology.types';
import type { Manifest } from './manifest.types';
import { UI_COLORS } from './colors';

// ---------------------------------------------------------------------------
// Entity kind — compile-time registry of all known node kinds
// ---------------------------------------------------------------------------

export type EntityKind =
  | 'tank' | 'pump' | 'endpoint' | 'valve' | 'flow_sensor'
  | 'water_source' | 'filter' | 'dosing_pump'
  | 'vfd';

// ---------------------------------------------------------------------------
// Field definition (drives sidebar forms)
// ---------------------------------------------------------------------------

export interface FieldDef {
  key: string;
  label: string;
  type: 'text' | 'number' | 'pin' | 'toggle' | 'select';
  placeholder?: string;
  /** Optional one-line help text shown beneath the field. Use plain language. */
  hint?: string;
  /** Channel capability required for this field, e.g. 'adc', 'digital'. Filters channel selection. */
  pinCap?: PinCap;
  /** Optional input-time char filter. Applied via [charFilter] in the sidebar template. */
  inputPolicy?: InputPolicy;
  /** Choices for `type: 'select'`. */
  options?: ReadonlyArray<{ value: string; label: string }>;
  /** On a `pin` field, names the sibling field that holds the relay polarity for this pin.
   *  Lets pin-collect attach polarity to the doc table without string-munging field keys. */
  polarityKey?: string;
  /** Only show this field when the predicate matches the node's current data. */
  visibleWhen?: FieldPredicate;
}

export type FieldPredicate =
  | { key: string; eq: string | boolean | number }
  | { key: string; in: ReadonlyArray<string | boolean | number> }
  | { key: string; neq: string | boolean | number };

// ---------------------------------------------------------------------------
// Codegen — ESPHome YAML/C++ fragment generators per entity kind
// ---------------------------------------------------------------------------

/**
 * Context passed to codegen functions. Provides channel resolution
 * without coupling entities to BoardDef or transport details.
 */
export type HaEntityKey =
  | 'level' | 'rawVoltage' | 'calEmpty' | 'calFull'
  | 'relay'
  | 'flow' | 'total' | 'sensorFault'
  | 'pressure'
  | 'rangeMin' | 'rangeMax'
  | 'inletPressure' | 'outletPressure' | 'deltaPressure'
  | 'cover' | 'openCoil' | 'closeCoil' | 'travelTime'
  | 'switch' | 'power' | 'frequency' | 'faultCode' | 'faultReset' | 'speedSetpoint';

export interface CodegenContext {
  /** Resolve a channel ID + usage to an ESPHome platform + config block. */
  resolveChannel: (channelId: string, usage: ChannelUsage) => ResolvedChannel;
}

export interface EntityCodegen<T extends Record<string, any> = Record<string, any>> {
  /** YAML fragment for sensors.yaml sensor: section (ADC, pulse counter, template sensors). */
  sensors?: (node: T, index: number, ctx: CodegenContext) => string;
  /** YAML fragment for hardware.yaml switch: section (switches, relays). */
  hardware?: (node: T, index: number, ctx: CodegenContext) => string;
  /** Substitution lines for device.yaml (non-pin substitutions only). */
  substitutions?: (node: T) => string[];
  /** Additional globals for control.yaml. */
  globals?: (node: T) => string;
  /**
   * Additional ESPHome component blocks keyed by YAML section name.
   * e.g. { number: "- platform: ...", cover: "- platform: ...", button: "- platform: ..." }
   * Each value is a YAML fragment (indented with 2 spaces) appended to that section.
   */
  extraComponents?: (node: T, index: number, ctx: CodegenContext) => Record<string, string>;
  /**
   * The HA entity_ids this entity contributes, keyed by a stable role name
   * (e.g. `level`, `rawVoltage`, `calEmpty`, `calFull` for a level sensor).
   *
   * Single source of truth for HA references: dashboard / automations /
   * site-dashboard / ha-meta consume these instead of reconstructing entity_id
   * strings. Each implementation must reuse the same name strings its
   * `sensors` / `extraComponents` / `hardware` functions emit, so a rename
   * is impossible to forget on either side.
   *
   * Returned record's keys may include conditional entries that resolve to
   * `undefined` when the entity-feature isn't configured (e.g. VFD power
   * sensor only exists if `power_register` is set).
   */
  haEntityIds?: (
    node: T,
    device: { friendly_name: string },
  ) => Record<string, string | undefined>;
  /**
   * Remote proxy YAML sections for imported nodes.
   * Called by collect.ts instead of local hardware. Each returned section
   * is emitted into the corresponding ESPHome YAML section.
   * Must include the state-tracking homeassistant sensor + template proxy.
   */
  remoteProxy?: (node: T, haEntityId: string, remoteDeviceName?: string, ownerDeviceName?: string) => Array<{ section: string; yaml: string }> | null;
  /**
   * HA entity IDs created by the proxy. Used by dashboard generators
   * to reference imported actuators correctly.
   */
  proxyEntityIds?: (node: T, device: { friendly_name: string }) => Record<string, string | undefined>;
}

// ---------------------------------------------------------------------------
// Validation — per-entity topology rules
// ---------------------------------------------------------------------------

export interface EntityRule {
  id: string;
  severity: 'error' | 'warning';
  /** Evaluate this rule against nodes of this kind. */
  evaluate: (
    kindNodes: TopologyNode[],
    allNodes: TopologyNode[],
  ) => Array<{ message: string; target?: string }>;
}

/**
 * Route-aware entity rule — validates a single node within the context of a
 * route.  Receives the full node data, the route, and the graph so it can
 * inspect both node properties and topology.
 *
 * Use for validations that are conditional on node configuration (e.g. a
 * pressurised water source needs a downstream valve, but an unpressurised one
 * does not).
 */
export interface RouteRule {
  id: string;
  severity: 'error' | 'warning';
  /** Evaluate this rule for a single node within a route. Return null when satisfied. */
  evaluate: (
    node: TopologyNode,
    route: Route,
    graph: TopologyGraph,
  ) => RuleDiagnostic | null;
}

// ---------------------------------------------------------------------------
// Node descriptor
// ---------------------------------------------------------------------------

export type DeadManAction = 'stop' | 'hold' | 'revert';

export interface SafetyProfile {
  /** True if this actuator can cause physical damage (dry-run, flood, chemical overdose). */
  safetyCritical: boolean;
  /** Sensors that must be present and monitored when this actuator runs. */
  requiredSensors: Array<{
    kind: string;
    position: 'upstream' | 'downstream' | 'inline';
    severity: 'error' | 'warning';
    reason: string;
  }>;
  /** Max runtime if no explicit route limit is set (dead-man fallback). */
  deadManTimeoutMs: number;
  /** What the anchor does when a remote claim expires. */
  deadManAction: DeadManAction;
}

export interface NodeDescriptor {
  kind: EntityKind;
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

  /** Route-aware validation rules — checked per-node per-route. */
  routeRules?: RouteRule[];

  /** Flow constraints this entity declares on routes it appears in. */
  constraints?: FlowConstraint[];

  /** Safety profile for this entity kind. Drives firmware dead-man behavior and validation. */
  safetyProfile?: SafetyProfile;

  // --- Home Assistant integration (consumed by TopologyRenderer.exportHa + farm-scada-card) ---

  /**
   * Default HA domain for this kind, used to suggest entity IDs and pick
   * fallback services (e.g. `switch` → `switch.toggle`).
   */
  haDomain?: string;
  /**
   * Default action list for this kind. Resolved at export time; a node's
   * `haActions` overrides these. Each action becomes a menu item in the card.
   */
  defaultHaActions?: HaActionSpec[];
  /**
   * Declared slots this entity's rendered SVG exposes. The exporter injects
   * a `<text data-slot="<name>">` at the given local-coord position for any
   * node that has a matching `binds` entry. Omit to accept the default label
   * slot below the node.
   */
  slots?: Record<string, HaSlotSpec>;
  /**
   * Default bind expressions to apply when a node sets `entityId` but does
   * not specify bindings. Keys must match `slots` keys (or 'label' default).
   */
  defaultBinds?: Record<string, string>;

  // --- Dispatch flags — tell the graph layer and generators what this entity does ---

  /** Acts as a pump — participates in pump refcounting. */
  isPump?: boolean;
  /** Acts as a valve — included in route valve masks and dispatch. */
  isValve?: boolean;
  /** Acts as a flow sensor — required for valid routes, flow dispatch. */
  isFlowSensor?: boolean;
  /** Acts as a dosing pump — participates in dead-man claim tracking. */
  isDosingPump?: boolean;
  /** Conflict class: 'sensor' readings are ambiguous when shared, 'actuator' access is refcountable. */
  conflictClass?: 'sensor' | 'actuator';
}

// ---------------------------------------------------------------------------
// Entity color lookup
// ---------------------------------------------------------------------------

export function entityColor(kind: string): string {
  return NODE_REGISTRY.get(kind)?.color ?? UI_COLORS.text;
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
import { filterDescriptor } from './entities/filter';
import { dosingPumpDescriptor } from './entities/dosing-pump';
import { vfdDescriptor } from './entities/vfd';

export const ALL_DESCRIPTORS: readonly NodeDescriptor[] = [
  tankDescriptor,
  pumpDescriptor,
  endpointDescriptor,
  valveDescriptor,
  flowSensorDescriptor,
  waterSourceDescriptor,
  filterDescriptor,
  dosingPumpDescriptor,
  vfdDescriptor,
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
          const desc = NODE_REGISTRY.get(n.kind);
          return desc?.experimental && !desc.codegen;
        })
        .map(n => ({
          message: `"${n.name ?? n.id}" is experimental and will not generate hardware configuration.`,
          target: n.id,
        }));
    },
  },
  // pump-id-uniqueness removed — per-node pumpSwitchId() makes multiple pumps safe.
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type DispatchFlag = 'isPump' | 'isValve' | 'isFlowSensor' | 'isDosingPump';

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
export function nodesWithFlag<T extends { kind: string; [k: string]: any }>(
  nodes: T[],
  flag: DispatchFlag,
): T[] {
  return nodes.filter(n => NODE_REGISTRY.get(n.kind)?.[flag]);
}

// ---------------------------------------------------------------------------
// Manifest-aware helpers — operate on the split manifest arrays
// ---------------------------------------------------------------------------

/** All nodes (local + imported). Use for route table generation. */
export function allNodes(m: Manifest): Manifest['nodes'] | Manifest['imports'] {
  return [...m.nodes, ...m.imports];
}

/** Local nodes matching a dispatch flag. Use for hardware generators. */
export function localNodesWithFlag(m: Manifest, flag: DispatchFlag): Manifest['nodes'] {
  return nodesWithFlag(m.nodes, flag);
}

/** Imported nodes matching a dispatch flag. Use for proxy/dashboard. */
export function importedNodesWithFlag(m: Manifest, flag: DispatchFlag): Manifest['imports'] {
  return nodesWithFlag(m.imports, flag);
}

/** Imported nodes by kind. */
export function importedNodesByKind<K extends TopologyNode['kind']>(
  m: Manifest, kind: K,
): Extract<Manifest['imports'][number], { kind: K }>[] {
  return m.imports.filter((n): n is Extract<typeof n, { kind: K }> => n.kind === kind);
}
