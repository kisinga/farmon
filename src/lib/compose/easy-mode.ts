/**
 * Easy Mode composer.
 *
 * Turns a small profile of plain answers into a complete, valid SiteTopology,
 * then opens it in Expert Mode. Node facts (ports, defaults, pin needs) are
 * derived from the entity registry and the board, never restated here. See
 * docs/development/easy-mode-onboarding-spec.md.
 *
 * Scope: a tree of one supply (or a few merging at one tank), zero or one tank,
 * fan-out to several demand zones, on a single board. Anything bigger hands off
 * to Expert Mode or a setup service.
 */
import { NODE_REGISTRY, REGISTRY_RULES, type NodeDescriptor } from '../entity-registry';
import type { SiteTopology, TopologyNode, PipeSegment, Controller, RouteOverride } from '../topology.types';
import type { BoardDef, PinCap } from '../board.types';
import { isFieldVisible } from '../pin-collect';
import { autoAssignPins } from './auto-pins';
import type { RuleDiagnostic } from '../validation.types';
import { buildGraph, type TopologyGraph } from '../graph/topology-graph';
import { activeGraph } from '../graph/active-graph';
import { deriveRoutes, type Route } from '../graph/routes';
import { evaluateConstraints } from '../graph/evaluate-constraints';
import { evaluateRouteRules } from '../graph/evaluate-route-rules';
import { SOURCE_META, sourceHasPump, multiSourceNeedsTank, type Vertical, type SourceKind, type Conveyance, type Priority } from './catalog';

// The profile vocabulary (verticals, sources, …) is owned by the catalog — the
// single source of customer-facing copy and the closed answer sets. Re-exported
// here so `@core` consumers keep importing the types from one place.
export type { Vertical, SourceKind, Conveyance, Priority } from './catalog';

// --- Profile (the resolved answers) ----------------------------------------

export interface EasyModeProfile {
  friendlyName?: string;
  vertical: Vertical;
  /** One or more sources. Two or more merge at the tank. */
  sources: SourceKind[];
  /** 0 = none, 1 = one. 2+ is treated as one logical tank for now (see notes). */
  tanks: number;
  zones: number;
  /** Observed water force. We trust it; the vertical never forces a pump. */
  conveyance?: Conveyance;
  priority?: Priority;
}

export type Handoff = 'expert' | 'setup_service';

export interface ComposeResult {
  topology: SiteTopology | null;
  handoff?: Handoff;
  notes: string[];
  diagnostics: RuleDiagnostic[];
  budget: PinBudget;
}

interface PinBudget { relays: number; analog: number; pulse: number; }
const BOARD_LIMITS: PinBudget = { relays: 16, analog: 4, pulse: 3 };

/** The single board Easy Mode targets — one source of truth for the model id.
 *  This is the catalog model id controllers reference (per defaults/configs/
 *  kc868-a16-controller.yaml), not the def's internal `model` field. */
export const EASY_MODE_BOARD = 'kc868-a16';

// --- Registry-derived helpers (pure functions over NodeDescriptor) ----------

function desc(kind: string): NodeDescriptor {
  const d = NODE_REGISTRY.get(kind);
  if (!d) throw new Error(`Easy Mode: unknown node kind "${kind}"`);
  return d;
}

function portByDir(kind: string, dir: 'inlet' | 'outlet'): string {
  const p = desc(kind).defaultPorts.find(pp => pp.direction === dir);
  if (!p) throw new Error(`Easy Mode: ${kind} has no ${dir} port`);
  return p.id;
}

/**
 * Easy Mode policy: which pin fields to actually wire. Core pins (relays, flow,
 * coils) are always needed. Optional sensor pins are not: Easy Mode never adds
 * incoming-pressure monitoring on a source, and only wires a tank's level pin
 * when that tank is level-monitored.
 */
function needsPin(node: TopologyNode, fieldKey: string): boolean {
  if (node.kind === 'water_source') return false;
  if (node.kind === 'tank' && fieldKey === 'pressure_pin') {
    return (node as Record<string, unknown>)['level_monitored'] === true;
  }
  return true;
}

/** Board-pool cost of a node, by pin cap, honouring field visibility and policy. */
export function pinCost(node: TopologyNode): Partial<Record<PinCap, number>> {
  const rec = node as unknown as Record<string, unknown>;
  const out: Partial<Record<PinCap, number>> = {};
  for (const f of desc(node.kind).sidebarFields) {
    if (f.type !== 'pin' || !f.pinCap || !isFieldVisible(f, rec) || !needsPin(node, f.key)) continue;
    out[f.pinCap] = (out[f.pinCap] ?? 0) + 1;
  }
  return out;
}

/** Pin demand (relays/analog/pulse) summed from the registry — needs no board. */
function demandBudget(nodes: TopologyNode[]): PinBudget {
  const b: PinBudget = { relays: 0, analog: 0, pulse: 0 };
  for (const node of nodes) {
    const c = pinCost(node);
    b.relays += c.digital ?? 0;
    b.analog += c.adc ?? 0;
    b.pulse += c.pulse_counter ?? 0;
  }
  return b;
}

// --- Node / pipe builder ----------------------------------------------------

class Builder {
  nodes: TopologyNode[] = [];
  pipes: PipeSegment[] = [];
  private counts = new Map<string, number>();
  private pipeN = 0;
  constructor(private anchorId: string) {}

  add(kind: string, data: Record<string, unknown> = {}, position = { x: 0, y: 0 }): TopologyNode {
    const d = desc(kind);
    const n = (this.counts.get(kind) ?? 0) + 1;
    this.counts.set(kind, n);
    const node = {
      kind,
      id: `${kind}${n}`,
      anchorId: this.anchorId,
      ...d.defaultData(n),
      ...data,
      ports: d.defaultPorts.map(p => ({ ...p })),
      position,
    } as unknown as TopologyNode;
    this.nodes.push(node);
    return node;
  }

  connect(from: TopologyNode, to: TopologyNode): void {
    this.pipeN += 1;
    this.pipes.push({
      id: `pipe${this.pipeN}`,
      from: `${from.id}:${portByDir(from.kind, 'outlet')}`,
      to: `${to.id}:${portByDir(to.kind, 'inlet')}`,
    });
  }

  /** Connect a chain in series and return the last node. */
  chain(...nodes: TopologyNode[]): TopologyNode {
    for (let i = 0; i < nodes.length - 1; i++) this.connect(nodes[i], nodes[i + 1]);
    return nodes[nodes.length - 1];
  }
}

// --- Safe per-route defaults ------------------------------------------------

/** Stop a fill before the tank overflows. */
const SAFE_DEST_MAX_LEVEL = 92;
/** Stop a draw before the tank runs dry (and the pump dead-heads). */
const SAFE_SOURCE_MIN_LEVEL = 18;

const isLevelTank = (n: TopologyNode | undefined): boolean =>
  n?.kind === 'tank' && (n as Record<string, unknown>)['level_monitored'] === true;

/**
 * Conservative level cut-offs per route, set only where the firmware can act on
 * them — i.e. where the route's source/dest is a level-monitored tank. This is
 * exactly the shape topology-to-manifest reads (source_min_level / dest_max_level
 * gated on the endpoint having level), so it never emits an override the firmware
 * would ignore. Max runtime is left to the firmware backstop (1800 s).
 */
function buildRouteOverrides(routes: Route[], byId: Map<string, TopologyNode>): Record<string, RouteOverride> {
  const out: Record<string, RouteOverride> = {};
  for (const r of routes) {
    const ov: RouteOverride = {};
    if (isLevelTank(byId.get(r.destination))) ov.dest_max_level = SAFE_DEST_MAX_LEVEL;
    if (isLevelTank(byId.get(r.source))) ov.source_min_level = SAFE_SOURCE_MIN_LEVEL;
    if (Object.keys(ov).length) out[r.key] = ov;
  }
  return out;
}

// --- Validation backstop (the same rules Expert Mode runs) -------------------

function validate(graph: TopologyGraph, routes: Route[], nodes: TopologyNode[], withPins: boolean): RuleDiagnostic[] {
  const diags: RuleDiagnostic[] = [
    ...evaluateConstraints(graph, routes),
    ...evaluateRouteRules(graph, routes),
  ];
  // Pin-dependent entity rules (missing-pin, calibration) and cross-cutting
  // registry rules only make sense once GPIOs are assigned. In estimation mode
  // (no board) we keep the structural checks and skip these.
  if (withPins) {
    for (const [kind, d] of NODE_REGISTRY) {
      const kindNodes = nodes.filter(n => n.kind === kind);
      for (const rule of d.rules ?? []) {
        for (const r of rule.evaluate(kindNodes, nodes)) {
          diags.push({ severity: rule.severity, message: r.message, target: r.target, ruleId: rule.id });
        }
      }
    }
    for (const rule of REGISTRY_RULES) {
      for (const r of rule.evaluate([], nodes)) {
        diags.push({ severity: rule.severity, message: r.message, target: r.target, ruleId: rule.id });
      }
    }
  }
  return diags;
}

// --- The composer -----------------------------------------------------------

/** One supply station and the facts the fill/draw builders key off. */
interface Supply {
  src: SourceKind;
  /** The water_source node. */
  ws: TopologyNode;
  /** The node the rest of the system connects to (the pump, if any, else the source). */
  exit: TopologyNode;
  hasPump: boolean;
  pressurized: boolean;
}

/** One supply per source: a water_source, plus an intrinsic pump for borehole/river. */
function addSupplies(b: Builder, sources: SourceKind[]): Supply[] {
  return sources.map((src, i) => {
    const meta = SOURCE_META[src];
    const ws = b.add('water_source', { name: meta.nodeName, pressurized: !!meta.pressurized }, { x: 0, y: i * 140 });
    if (meta.pumpName) {
      const pump = b.add('pump', { name: meta.pumpName }, { x: 150, y: i * 140 });
      b.connect(ws, pump);
      return { src, ws, exit: pump, hasPump: true, pressurized: !!meta.pressurized };
    }
    return { src, ws, exit: ws, hasPump: false, pressurized: !!meta.pressurized };
  });
}

/** Fill transfers: every supply feeds the tank, each end synthesized from its facts. */
function addFill(b: Builder, supplies: Supply[], tank: TopologyNode, notes: string[]): void {
  for (const s of supplies) {
    if (s.hasPump) {
      // dry-run flow protects the submersible/surface pump
      b.chain(s.exit, b.add('flow_sensor', { name: `${s.ws['name']} Flow` }, { x: 230, y: 0 }), tank);
    } else if (s.pressurized) {
      // pressurized mains needs an isolation valve downstream of the source
      b.chain(s.exit, b.add('valve', { name: `${s.ws['name']} Valve` }, { x: 230, y: 0 }), tank);
    } else {
      // trucked / rainwater: gravity or manual fill, no firmware control
      b.connect(s.exit, tank);
      if (s.src === 'trucked') notes.push('Trucked supply is manual: a low-level alert, no auto-refill.');
    }
  }
}

function handoff(kind: Handoff, note: string, notes: string[]): ComposeResult {
  return { topology: null, handoff: kind, notes: [...notes, note], diagnostics: [], budget: { relays: 0, analog: 0, pulse: 0 } };
}

/**
 * @param board        the board def, used to assign real pins (omit for estimation).
 * @param boardModel   the catalog model id the controller must reference (what the
 *                     editor loads the board by). Defaults to the def's model, then
 *                     EASY_MODE_BOARD. Pass the catalog id explicitly when it differs
 *                     from the def's own `model` field.
 * @param controllerId the controller's id. The default is fine for an ephemeral
 *                     estimate, but the persisted path MUST pass a globally-unique
 *                     id (the id is the provision PK / MQTT identity — a collision
 *                     would merge two sites into one). See backend.newControllerId.
 */
export function composeEasyMode(input: EasyModeProfile, board?: BoardDef, boardModel?: string, controllerId = 'controller1'): ComposeResult {
  const notes: string[] = [];
  const p: EasyModeProfile = { ...input };

  // --- scope gates ---
  if (p.zones > 7) return handoff('setup_service', 'More than seven areas needs a bigger setup.', notes);
  if (p.sources.length === 0) return handoff('expert', 'No water source selected.', notes);
  // Several tanks: Easy Mode can't guess series-vs-parallel, so it hands the
  // layout to the editor (where multiple tanks are supported) rather than silently
  // collapsing to one.
  if (p.tanks >= 2) {
    return handoff('expert', 'Several tanks: open the editor to lay them out (side by side, or one feeding another).', notes);
  }
  // Two or more sources need a shared tank to combine. We never force one against
  // a "no storage" answer; instead we say so and hand off.
  if (multiSourceNeedsTank(p.sources) && p.tanks === 0) {
    return handoff('expert', 'Two or more sources combine in a shared tank. Add one tank, or finish the layout in the editor.', notes);
  }

  // --- derived facts ---
  const hasTank = p.tanks >= 1;
  const tankPumpFilled = p.sources.some(sourceHasPump);
  const metering = p.vertical === 'water_business';
  const conveyance: Conveyance = p.conveyance ?? 'pump';
  const zoneCount = Math.max(1, p.zones);

  const controller: Controller = { id: controllerId, board: boardModel ?? board?.model ?? EASY_MODE_BOARD, friendlyName: p.friendlyName };
  const b = new Builder(controllerId);

  // --- supplies ---
  const supplies = addSupplies(b, p.sources);

  // --- tank ---
  // A pump-filled tank needs level monitoring (stop-at-full, draw dry-run); seed a
  // starting calibration so firmware generates clean. The customer tunes it later.
  const tank = hasTank
    ? b.add('tank', tankPumpFilled ? { level_monitored: true, height_m: 2, pressure_sensor_max_psi: 5 } : {}, { x: 340, y: 60 })
    : null;
  if (tank && tankPumpFilled) {
    notes.push('Tank level uses a starting calibration (2 m tank, 5 psi sensor); set your real tank height in the editor.');
  }

  // --- demand zones ---
  const zones = Array.from({ length: zoneCount }, (_, i) =>
    b.add('endpoint', { name: zoneCount === 1 ? 'House' : `Area ${i + 1}` }, { x: 820, y: i * 110 }));

  // --- fill transfers: supply -> tank ---
  if (tank) addFill(b, supplies, tank, notes);

  // --- draw side ---
  const drawSource = tank ?? supplies[0].exit;
  const drawSourcePressurized = !tank && (supplies[0].pressurized || supplies[0].hasPump);

  let drawTrunk = drawSource;
  let boosterPresent = false;
  if (conveyance === 'pump' && !drawSourcePressurized) {
    const booster = b.add('pump', { name: 'Booster Pump' }, { x: 500, y: 60 });
    b.connect(drawTrunk, booster);
    drawTrunk = booster;
    boosterPresent = true;
  }

  const drawHasPump = boosterPresent || (!tank && supplies[0].hasPump);
  const drawProtectedByLevel = !!(tank && tankPumpFilled);
  const drawNeedsFlow = drawHasPump && !drawProtectedByLevel;

  if (zoneCount === 1) {
    let last = drawTrunk;
    if (drawNeedsFlow || metering) {
      last = b.chain(last, b.add('flow_sensor', { name: 'Flow' }, { x: 640, y: 60 }));
    }
    // a pressurized source feeding a zone directly needs a downstream valve
    if (!tank && supplies[0].pressurized) {
      last = b.chain(last, b.add('valve', { name: 'Shutoff' }, { x: 720, y: 60 }));
    }
    b.connect(last, zones[0]);
  } else {
    // fan-out: one valve per branch; dry-run flow on the first branch (after its
    // valve, to satisfy valve-before-flow), or a flow per branch when metering.
    zones.forEach((zone, i) => {
      const valve = b.add('valve', { name: `${zone['name']} Valve` }, { x: 640, y: i * 110 });
      b.connect(drawTrunk, valve);
      const wantFlow = metering || (i === 0 && drawNeedsFlow);
      if (wantFlow) {
        b.chain(valve, b.add('flow_sensor', { name: metering ? `${zone['name']} Flow` : 'Flow' }, { x: 730, y: i * 110 }), zone);
      } else {
        b.connect(valve, zone);
      }
    });
  }

  // --- assemble ---
  const topology: SiteTopology = {
    schema: 18,
    controllers: [controller],
    nodes: b.nodes,
    pipes: b.pipes,
    route_overrides: {},
    timing: { valve_travel_time: 15, flow_watchdog: 30, flow_confirm: 10, flow_threshold: 0.5, update_interval: 10 },
    remoteImports: [],
    layout: { controllers: { [controllerId]: { x: 0, y: 0 } } },
  };

  // Pin budget is demand from the registry (no board needed); a board, when
  // given, also gets real GPIOs assigned. Without one this is estimation mode.
  const budget = demandBudget(b.nodes);
  const overBudget =
    budget.relays > BOARD_LIMITS.relays || budget.analog > BOARD_LIMITS.analog || budget.pulse > BOARD_LIMITS.pulse;
  if (overBudget) {
    return {
      topology, handoff: 'setup_service', budget, diagnostics: [],
      notes: [...notes, `This design exceeds one controller (${budget.relays}/16 relays, ${budget.analog}/4 analog, ${budget.pulse}/3 pulse). Continue in Expert Mode or with a setup service.`],
    };
  }
  if (board) {
    const { unassigned } = autoAssignPins(b.nodes, board, { include: needsPin });
    if (unassigned.length > 0) {
      return {
        topology, handoff: 'setup_service', budget, diagnostics: [],
        notes: [...notes, `Could not wire ${unassigned.length} connection(s) on this controller; finish in the editor or use a setup service.`],
      };
    }
  }

  // Derive the routes once: they feed both the safe per-route defaults and the
  // validation backstop (same graph, built one time).
  const graph = activeGraph(buildGraph(b.nodes, b.pipes));
  const routes = deriveRoutes(graph);
  const byId = new Map(b.nodes.map(n => [n.id, n]));
  topology.route_overrides = buildRouteOverrides(routes, byId);

  // The graph is built from the same definitions the validator checks, so this is
  // a backstop, not the primary safety net. Should it ever flag an error we can't
  // fix automatically, hand the (saved) topology to Expert Mode rather than emit
  // something that would flash broken firmware.
  const diagnostics = validate(graph, routes, b.nodes, !!board);
  const errors = diagnostics.filter(d => d.severity === 'error');
  if (errors.length) {
    return {
      topology, handoff: 'expert', budget, diagnostics,
      notes: [...notes, `This design needs a manual tweak (${errors[0].message}). We'll open it in the editor so you can finish it.`],
    };
  }

  return { topology, notes, budget, diagnostics };
}

// --- Estimation harness (no account, no board needed) -----------------------

export interface SystemEstimate {
  /** Board model the estimate is sized against. */
  board: string;
  /** Whether the design fits one controller (no handoff). */
  fits: boolean;
  handoff?: Handoff;
  /** Pin demand. */
  budget: PinBudget;
  /** Board pin limits the demand is measured against. */
  limits: PinBudget;
  /** Bill of materials, by node kind. */
  components: Array<{ kind: string; label: string; count: number }>;
  notes: string[];
  /** The composed topology (no pins in estimation mode) — for previews and the
   *  quote document. Null only when a scope gate returns before building one. */
  topology: SiteTopology | null;
}

const COMPONENT_LABELS: Record<string, string> = {
  water_source: 'Water source', pump: 'Pump', tank: 'Tank',
  valve: 'Motorised valve', flow_sensor: 'Flow meter', endpoint: 'Outlet / zone',
};

/**
 * Estimate the hardware a profile needs, without creating anything. Runs the
 * same composer (board optional) and summarises a bill of materials. Pure, no
 * auth, no backend — safe to call from the public pricing / estimator side to
 * show a glimpse of the system before account creation.
 */
export function estimateSystem(input: EasyModeProfile, board?: BoardDef): SystemEstimate {
  const r = composeEasyMode(input, board);
  const counts: Record<string, number> = {};
  for (const n of r.topology?.nodes ?? []) counts[n.kind] = (counts[n.kind] ?? 0) + 1;
  const components = Object.entries(counts)
    .map(([kind, count]) => ({ kind, label: COMPONENT_LABELS[kind] ?? kind, count }))
    .sort((a, b) => b.count - a.count);
  return {
    board: board?.model ?? EASY_MODE_BOARD,
    fits: !r.handoff,
    handoff: r.handoff,
    budget: r.budget,
    limits: { ...BOARD_LIMITS },
    components,
    notes: r.notes,
    topology: r.topology,
  };
}
