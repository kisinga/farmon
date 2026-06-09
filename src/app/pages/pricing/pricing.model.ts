/**
 * MajiFlow pricing model — the single edit point for the (not-yet-final)
 * numbers. The estimator UI and any price copy read from here, so changing a
 * figure is a one-line edit. All amounts are KES.
 *
 * The model: a site is sold in **controller bundles**. One bundle is a complete
 * working system (controller + pump + one valve + one flow sensor + one tank
 * monitor + cloud onboarding). Extra peripherals add onto the same controller
 * up to the board's hardware caps; past a cap you need another full bundle.
 */
export const PRICING = {
  /** One controller bundle (KC868 + pump + 1 valve + 1 flow + 1 tank monitor + cloud). */
  bundle: 35_000,
  /** Each extra standard (≤3/4") peripheral on the same controller. */
  extraValve: 4_000,
  extraFlow: 4_000,
  extraTank: 5_000,
  /** Extra pump relay, 30A max: switches a single-phase pump up to ~2 hp (1.5 kW)
   *  at 240V directly. Bigger motors need a contactor (custom-quoted).
   *  PLACEHOLDER price, confirm. */
  extraPumpRelay: 4_000,
  /** Hosted backend upkeep — per site, billed yearly after the first year. */
  yearly: 4_000,
  /** On-Prem (Custom) entry point — bespoke, not estimated here. */
  onPremFrom: 200_000,
  /** Per-controller hardware caps (KC868-A16). Valve cap is derived from the
   *  relay pool below; this 7 is the headline figure for one relay pump. */
  caps: { valves: 7, flow: 3, tanks: 4 },
  /** KC868-A16 relay pool: a relay pump uses 1 relay, a motorized valve uses 2.
   *  Pumps and valves compete for the same 16 relays — more pumps, fewer valves. */
  relays: { total: 16, perPump: 1, perValve: 2 },
} as const;

export interface EstimateInput {
  pumps: number;
  valves: number;
  flow: number;
  tanks: number;
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

export interface Estimate {
  controllers: number;
  lines: EstimateLine[];
  oneTime: number;
  yearly: number;
  /** True when more than one controller is needed (the Hosted "islands" caveat). */
  multiController: boolean;
  input: EstimateInput;
}

const ceilDiv = (n: number, d: number) => Math.ceil(n / d);

/**
 * Pure cost estimate. Packs the requested peripherals into the fewest
 * controllers the board allows, then bills only the surplus over the one-of-each
 * every bundle includes.
 *
 * Controller count `K` is bounded by three independent limits:
 *   - relay pool: pumps (1 relay) + valves (2 relays) ≤ 16 per controller
 *   - flow sensors ≤ 3 per controller (pulse-counter pins)
 *   - tank monitors ≤ 4 per controller (ADC pins)
 * so `K = max(1, ⌈(pumps + 2·valves)/16⌉, ⌈flow/3⌉, ⌈tanks/4⌉)`.
 */
export function estimate(raw: EstimateInput): Estimate {
  const pumps = Math.max(0, Math.floor(raw.pumps));
  const valves = Math.max(0, Math.floor(raw.valves));
  const flow = Math.max(0, Math.floor(raw.flow));
  const tanks = Math.max(0, Math.floor(raw.tanks));
  const { caps, relays, bundle, extraPumpRelay, extraValve, extraFlow, extraTank, yearly } = PRICING;

  // 3-phase pumps run via their own VFD over RS485 — no board relay, no add-on cost.
  const pumpRelays = raw.threePhase ? 0 : relays.perPump;
  const relaysNeeded = pumps * pumpRelays + valves * relays.perValve;

  const controllers = Math.max(
    1,
    ceilDiv(relaysNeeded, relays.total),
    ceilDiv(flow, caps.flow),
    ceilDiv(tanks, caps.tanks),
  );

  const extraPumps = Math.max(0, pumps - controllers);
  const pumpUnit = raw.threePhase ? 0 : extraPumpRelay;
  const extraValves = Math.max(0, valves - controllers);
  const extraFlows = Math.max(0, flow - controllers);
  const extraTanks = Math.max(0, tanks - controllers);

  const lines: EstimateLine[] = [
    {
      label: controllers > 1 ? `Controller bundles (×${controllers})` : 'Controller bundle',
      qty: controllers,
      unit: bundle,
      total: controllers * bundle,
    },
  ];
  if (extraPumps && pumpUnit > 0) lines.push({ label: 'Extra pump relays (30A max)', qty: extraPumps, unit: pumpUnit, total: extraPumps * pumpUnit });
  if (extraValves) lines.push({ label: 'Extra valves', qty: extraValves, unit: extraValve, total: extraValves * extraValve });
  if (extraFlows) lines.push({ label: 'Extra flow sensors', qty: extraFlows, unit: extraFlow, total: extraFlows * extraFlow });
  if (extraTanks) lines.push({ label: 'Extra tank monitors', qty: extraTanks, unit: extraTank, total: extraTanks * extraTank });

  const oneTime = lines.reduce((sum, l) => sum + l.total, 0);

  return {
    controllers,
    lines,
    oneTime,
    yearly,
    multiController: controllers > 1,
    input: { pumps, valves, flow, tanks, largeSize: raw.largeSize, bigPump: raw.bigPump, threePhase: raw.threePhase },
  };
}

/** KES formatter, e.g. 84000 → "KES 84,000". */
export function kes(n: number): string {
  return 'KES ' + n.toLocaleString('en-KE');
}
