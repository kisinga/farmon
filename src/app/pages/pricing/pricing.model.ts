/**
 * MajiFlow pricing model — the single edit point for the (not-yet-final) numbers.
 * The estimator UI and any price copy read from here, so changing a figure is a
 * one-line edit. All amounts are KES.
 *
 * A site grows two ways, and physical distance decides which:
 *   - Deeper: saturate one controller. Sensing overflow (extra tanks/flow) goes on
 *     a metering hub over one Modbus wire — cheaper than another brain.
 *   - Wider: when gear is too far to wire, add another controller (a bare node, not
 *     a full bundle) and they run as one over WiFi.
 *
 * The rule the estimate follows: control (pumps/valves) stays on its own brain;
 * sensing (tanks/flow) is what stretches onto a hub. See estimate().
 *
 * Money is three layers: one-time hardware (the subsidised wedge), a per-controller
 * monthly subscription (the revenue stream — what we actually sell), and optional
 * segment packs. The estimator leads with the monthly.
 *
 * PLACEHOLDER prices below (`node`, `meteringHub`, segment pack `fromMonthly`) are
 * marked and must be confirmed before launch.
 */
export const PRICING = {
  /** One controller bundle (KC868-A16 + pump + 1 valve + 1 flow + 1 tank monitor + cloud). */
  bundle: 55_000,
  /** A bare extra controller for *wider* growth: brain + enclosure + cloud onboarding,
   *  no peripherals (those are added as extras). Cheaper than a bundle so meshing a far
   *  cluster is not punished. PLACEHOLDER, confirm. */
  node: 30_000,
  /** Metering hub: the waveshare-modbus-ai-8ch board, adds `hubPaths` analog tank-level
   *  paths over one RS485 wire (flow is pulse-counted and stays onboard). Sold near cost:
   *  it does the monitoring work of several controllers, so its margin is recovered in the
   *  billing/metering pack, not here and not on the sensors (customers bring their own
   *  meters). Keep per-path (meteringHub/hubPaths) below `extraTank` so filling the hub
   *  beats onboard tanks. PLACEHOLDER, confirm. */
  meteringHub: 10_000,
  /** Monitored paths added per metering hub. */
  hubPaths: 8,
  /** Each extra standard (≤3/4") peripheral on the same controller. */
  extraValve: 4_000,
  extraFlow: 4_000,
  extraTank: 5_000,
  /** Extra pump relay, 30A max: switches a single-phase pump up to ~2 hp (1.5 kW)
   *  at 240V directly. Bigger motors need a contactor (custom-quoted). PLACEHOLDER. */
  extraPumpRelay: 4_000,
  /** Subscription: the revenue stream, and what the page leads with. Graduated
   *  per-controller monthly brackets, marginal like tax brackets, floored at the last
   *  rate. More controllers raise it; adding tanks to one controller does not (density
   *  is free, so "deeper before wider" still pays). `upTo` is the inclusive controller
   *  index the rate covers. KES per controller / month. */
  subscription: [
    { upTo: 1, rate: 2_500 }, // Lite: the 1st controller
    { upTo: 4, rate: 2_000 }, // Plus: controllers 2-4
    { upTo: 10, rate: 1_500 }, // Pro: controllers 5-10
    { upTo: Infinity, rate: 1_000 }, // Scale: 11+, the floor
  ],
  /** Per-controller sensing pins (KC868-A16); valve and pump limits come from the relay pool. */
  caps: { flow: 3, tanks: 4 },
  /** KC868-A16 relay pool: a relay pump uses 1 relay, a motorized valve uses 2.
   *  Pumps and valves compete for the same 16 relays — more pumps, fewer valves. */
  relays: { total: 16, perPump: 1, perValve: 2 },
} as const;

/** A site's type. Drives the dashboard skin and which pack is pitched — never a
 *  feature gate. Kept identical to the backend `sites.segment` enum and
 *  CoreCapabilities contract (Go and TS cannot share code). */
export type Segment = 'farm' | 'property' | 'water_supply';

/** The headline pack pitched per segment. `fromMonthly` null = price not set yet
 *  (the UI shows "pricing on request"). The pack is where premium margin lives; the
 *  near-cost metering hub is the enabler that unlocks it. PLACEHOLDER prices. */
export const SEGMENT_PACKS: Record<Segment, { label: string; fromMonthly: number | null }> = {
  farm: { label: 'Smart irrigation', fromMonthly: null },
  property: { label: 'Tenant billing', fromMonthly: null },
  water_supply: { label: 'Metering & protection', fromMonthly: null },
};

export interface EstimateInput {
  pumps: number;
  valves: number;
  flow: number;
  tanks: number;
  /** What the site is for — selects the pitched pack. */
  segment: Segment;
  /** Gear more than ~100m apart? Forces *wider* growth (mesh nodes) instead of
   *  stretching sensing onto a metering hub. */
  spread: boolean;
  /** Any line/sensor larger than 3/4" → custom-priced, excluded from the figure. */
  largeSize: boolean;
  /** Any single-phase pump over ~2 hp (240V) needs a contactor: custom-priced,
   *  excluded. Only relevant for single-phase (relay-driven) pumps. */
  bigPump: boolean;
  /** Pumps are 3-phase → driven by their own VFD/inverter over RS485: zero board
   *  relays, no relay add-on cost. Not yet supported for every inverter brand. */
  threePhase: boolean;
}

export interface EstimateLine {
  label: string;
  qty: number;
  unit: number;
  total: number;
}

/** Plan name, derived from controller count. */
export type TierName = 'Lite' | 'Plus' | 'Pro' | 'Scale';

export interface Estimate {
  controllers: number;
  nodes: number;
  hubs: number;
  lines: EstimateLine[];
  /** One-time hardware (the subsidised wedge, near cost). */
  oneTime: number;
  /** The subscription, per month (the revenue stream — the headline). */
  monthly: number;
  /** Plan name for this controller count. */
  tier: TierName;
  /** The segment pack pitched on top (the profit). */
  pack: { label: string; fromMonthly: number | null };
  /** Plain growth-path summary, e.g. "1 controller + 1 metering hub". */
  summary: string;
  /** True when more than one controller is needed (the Hosted "islands" caveat). */
  multiController: boolean;
  input: EstimateInput;
}

const ceilDiv = (n: number, d: number) => Math.ceil(n / d);

/** Marginal sum of the per-controller subscription brackets (like tax brackets):
 *  controller 1 at the Lite rate, 2-4 at Plus, and so on. KES per month. */
export function subscriptionMonthly(controllers: number): number {
  let remaining = Math.max(0, Math.floor(controllers));
  let prev = 0;
  let total = 0;
  for (const b of PRICING.subscription) {
    const span = Math.min(remaining, b.upTo - prev);
    if (span > 0) {
      total += span * b.rate;
      remaining -= span;
    }
    prev = b.upTo;
    if (remaining <= 0) break;
  }
  return total;
}

/** The plan name for a controller count. */
export function tierName(controllers: number): TierName {
  const c = Math.max(1, Math.floor(controllers));
  if (c <= 1) return 'Lite';
  if (c <= 4) return 'Plus';
  if (c <= 10) return 'Pro';
  return 'Scale';
}

/**
 * Pure cost estimate. Applies the growth rule:
 *   - Control (pumps/valves) and flow both need onboard pins, so they set the brain count.
 *   - Tank levels that overflow the brains' analog pins go on a metering hub when
 *     colocated, or on additional brains when `spread`.
 * The first brain is a full `bundle`; additional brains are bare `node`s. Peripherals
 * beyond the one-of-each the bundle includes are billed as extras; sensing that lands
 * on a hub is paid for by the hub, not double-billed as an onboard extra.
 */
export function estimate(raw: EstimateInput): Estimate {
  const pumps = Math.max(0, Math.floor(raw.pumps));
  const valves = Math.max(0, Math.floor(raw.valves));
  const flow = Math.max(0, Math.floor(raw.flow));
  const tanks = Math.max(0, Math.floor(raw.tanks));
  const { caps, relays, bundle, node, meteringHub, hubPaths, extraPumpRelay, extraValve, extraFlow, extraTank } = PRICING;

  // 3-phase pumps run via their own VFD over RS485 — no board relay, no add-on cost.
  const pumpRelays = raw.threePhase ? 0 : relays.perPump;
  const relaysNeeded = pumps * pumpRelays + valves * relays.perValve;
  const controlControllers = Math.max(1, ceilDiv(relaysNeeded, relays.total));

  let controllers: number;
  let hubs: number;
  if (raw.spread) {
    // Wider: each distant cluster gets its own brain; nothing on a hub.
    controllers = Math.max(controlControllers, ceilDiv(flow, caps.flow), ceilDiv(tanks, caps.tanks));
    hubs = 0;
  } else {
    // Deeper: control and flow both need onboard pins, so they set the brain count;
    // only tank levels (analog) overflow onto a metering hub. Flow is pulse-counted and
    // the hub is analog-only, so flow never rides it.
    controllers = Math.max(controlControllers, ceilDiv(flow, caps.flow));
    const tankOverflow = Math.max(0, tanks - controllers * caps.tanks);
    hubs = ceilDiv(tankOverflow, hubPaths);
  }

  const nodes = controllers - 1;

  // Sensing that fits on the brains' pins is billed as onboard extras; the rest is on
  // the hub. Control (pumps/valves) is always onboard.
  const onboardTanks = raw.spread ? tanks : Math.min(tanks, controllers * caps.tanks);
  // Flow always fits onboard: the brain count is sized to hold it, so it is never on a hub.
  const onboardFlow = flow;
  const extraPumps = Math.max(0, pumps - 1);
  const extraValves = Math.max(0, valves - 1);
  const extraFlows = Math.max(0, onboardFlow - 1);
  const extraTanks = Math.max(0, onboardTanks - 1);
  const pumpUnit = raw.threePhase ? 0 : extraPumpRelay;

  const lines: EstimateLine[] = [
    { label: 'Controller bundle', qty: 1, unit: bundle, total: bundle },
  ];
  if (nodes > 0) lines.push({ label: 'Extra controllers', qty: nodes, unit: node, total: nodes * node });
  if (extraPumps && pumpUnit > 0) lines.push({ label: 'Extra pump relays (30A max)', qty: extraPumps, unit: pumpUnit, total: extraPumps * pumpUnit });
  if (extraValves) lines.push({ label: 'Extra valves', qty: extraValves, unit: extraValve, total: extraValves * extraValve });
  if (extraFlows) lines.push({ label: 'Extra flow sensors', qty: extraFlows, unit: extraFlow, total: extraFlows * extraFlow });
  if (extraTanks) lines.push({ label: 'Extra tank monitors', qty: extraTanks, unit: extraTank, total: extraTanks * extraTank });
  if (hubs) lines.push({ label: `Metering hubs (+${hubPaths} paths each)`, qty: hubs, unit: meteringHub, total: hubs * meteringHub });

  const oneTime = lines.reduce((sum, l) => sum + l.total, 0);

  const brainWord = controllers === 1 ? '1 controller' : `${controllers} controllers`;
  const hubWord = hubs > 0 ? ` + ${hubs} metering hub${hubs > 1 ? 's' : ''}` : '';

  return {
    controllers,
    nodes,
    hubs,
    lines,
    oneTime,
    monthly: subscriptionMonthly(controllers),
    tier: tierName(controllers),
    pack: SEGMENT_PACKS[raw.segment],
    summary: brainWord + hubWord,
    multiController: controllers > 1,
    input: { pumps, valves, flow, tanks, segment: raw.segment, spread: raw.spread, largeSize: raw.largeSize, bigPump: raw.bigPump, threePhase: raw.threePhase },
  };
}

/** KES formatter, e.g. 84000 → "KES 84,000". */
export function kes(n: number): string {
  return 'KES ' + n.toLocaleString('en-KE');
}
