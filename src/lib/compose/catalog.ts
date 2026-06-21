/**
 * Easy Mode question catalog — the single source of truth for the customer-facing
 * option copy and the profile vocabulary.
 *
 * Both the onboarding stepper and the composer read from here, so the union types
 * and the rendered option lists can never drift (add a member to a union and the
 * `Record` below stops compiling until you give it copy). Node semantics still
 * live in the entity registry; this file only carries copy and the closed sets
 * the questions fill, plus the few source facts the composer keys off.
 *
 * See docs/development/easy-mode-onboarding-spec.md.
 */

// --- Profile vocabulary (the closed answer sets) ----------------------------

export type Vertical =
  | 'residential' | 'small_business' | 'farm' | 'hotel'
  | 'greenhouse' | 'commercial' | 'water_business';
export type SourceKind = 'mains' | 'borehole' | 'river' | 'trucked' | 'rainwater';
export type Conveyance = 'gravity' | 'pump';
export type Priority = 'dry_run' | 'continuity' | 'waste' | 'quality' | 'labor';

/** One selectable option: the closed value plus its display copy. */
export interface Choice<T extends string> {
  value: T;
  label: string;
  /** Optional one-line example shown under the label. */
  example?: string;
  /** Optional terse label for compact surfaces (e.g. the pricing estimator). */
  short?: string;
}

/**
 * Source facts the composer keys off, co-located with the copy so the
 * "mains is pressurized", "borehole has a submersible" knowledge lives in one
 * place instead of scattered string comparisons.
 */
export interface SourceMeta {
  /** Button label in the UI. */
  label: string;
  /** Name given to the water_source node on the canvas. */
  nodeName: string;
  /** Pressurized supply (mains): its fill always gets an isolation valve. */
  pressurized?: boolean;
  /** Surface water (river, rainwater): needs a filter before drip/sprinklers. */
  surface?: boolean;
  /** Intrinsic pump name (submersible/surface). Absent = no intrinsic pump. */
  pumpName?: string;
}

// --- Catalogs (Records are the SSOT; arrays are derived for ordered render) --
// A `Record<Union, …>` literal is exhaustive by construction: every union member
// must appear or it fails to compile. Iteration order is the literal's order, so
// the derived arrays render in the order written here — no separate order list.

const VERTICAL_META: Record<Vertical, { label: string; example?: string }> = {
  residential: { label: 'Home' },
  small_business: { label: 'Small business' },
  farm: { label: 'Irrigation farm', example: 'drip blocks, sprinkler lines' },
  hotel: { label: 'Hotel', example: 'lodge, guesthouse, restaurant' },
  greenhouse: { label: 'Greenhouse' },
  commercial: { label: 'Commercial' },
  water_business: { label: 'Water business', example: 'kiosk, community scheme' },
};

export const SOURCE_META: Record<SourceKind, SourceMeta> = {
  mains: { label: 'Mains', nodeName: 'Mains', pressurized: true },
  borehole: { label: 'Borehole', nodeName: 'Borehole', pumpName: 'Borehole Pump' },
  river: { label: 'River / dam', nodeName: 'River', surface: true, pumpName: 'Surface Pump' },
  trucked: { label: 'Trucking', nodeName: 'Trucked' },
  rainwater: { label: 'Rainwater', nodeName: 'Rainwater', surface: true },
};

const PRIORITY_META: Record<Priority, { label: string }> = {
  dry_run: { label: 'Running dry' },
  continuity: { label: 'Losing supply' },
  waste: { label: 'Waste or cost' },
  quality: { label: 'Water quality' },
  labor: { label: 'Manual labor' },
};

const CONVEYANCE_META: Record<Conveyance, { label: string; short: string }> = {
  gravity: { label: "No, it gets there on its own", short: 'No' },
  pump: { label: 'Yes, a pump pushes it', short: 'Yes' },
};

const toChoices = <T extends string>(meta: Record<T, { label: string; example?: string; short?: string }>): ReadonlyArray<Choice<T>> =>
  (Object.entries(meta) as [T, { label: string; example?: string; short?: string }][])
    .map(([value, m]) => ({ value, label: m.label, example: m.example, short: m.short }));

export const VERTICALS: ReadonlyArray<Choice<Vertical>> = toChoices(VERTICAL_META);
export const SOURCES: ReadonlyArray<Choice<SourceKind>> = toChoices(SOURCE_META);
export const PRIORITIES: ReadonlyArray<Choice<Priority>> = toChoices(PRIORITY_META);
export const CONVEYANCES: ReadonlyArray<Choice<Conveyance>> = toChoices(CONVEYANCE_META);

// --- Tank layouts (several tanks) -------------------------------------------
// Easy Mode caters for the few common shapes; anything else is "Custom", which
// an admin lays out on the canvas. A layout is a composition of the tank count:
// ordered group sizes, where each group is a parallel bank and groups feed one
// another in series. [n] = one bank, [1,1,…] = a full cascade, [2,1] = a pair
// feeding one. The composer reads `groups`; this is the SSOT for the count's
// presets and their copy.

/** Lower and upper bounds on tank count that Easy Mode will lay out. */
export const MIN_SEVERAL_TANKS = 2;
export const MAX_TANKS = 4;

export interface TankLayout {
  /** Ordered group sizes (a composition of the tank count). */
  groups: number[];
  label: string;
  /** Terse label for compact surfaces (e.g. the pricing estimator). */
  short: string;
}

const TANK_LAYOUTS: Record<number, readonly TankLayout[]> = {
  2: [
    { groups: [2], label: 'Side by side', short: 'Side by side' },
    { groups: [1, 1], label: 'One feeds the other', short: 'In series' },
  ],
  3: [
    { groups: [3], label: 'All side by side', short: 'Side by side' },
    { groups: [1, 1, 1], label: 'One feeds the next', short: 'In series' },
    { groups: [2, 1], label: 'A pair feeds one', short: 'Pair + one' },
  ],
  4: [
    { groups: [4], label: 'All side by side', short: 'Side by side' },
    { groups: [1, 1, 1, 1], label: 'One feeds the next', short: 'In series' },
    { groups: [2, 2], label: 'Two pairs in a row', short: 'Two pairs' },
  ],
};

/** The curated one-click layouts for a tank count (MIN..MAX). Anything outside
 *  these is "Custom" (an admin lays it out on the canvas). */
export function tankLayoutsFor(count: number): readonly TankLayout[] {
  return TANK_LAYOUTS[count] ?? [];
}

/** Validate a layout against a tank count: every group >= 1 and they sum to the
 *  count. Returns the groups when valid, else null (treated as "Custom"). */
export function validTankGroups(groups: number[] | undefined, count: number): number[] | null {
  if (!groups || groups.length === 0) return null;
  if (groups.some((g) => !Number.isInteger(g) || g < 1)) return null;
  return groups.reduce((a, c) => a + c, 0) === count ? groups : null;
}

/** Whether a source carries an intrinsic pump (submersible/surface). */
export const sourceHasPump = (s: SourceKind): boolean => !!SOURCE_META[s].pumpName;

/**
 * Two or more sources must merge at a shared tank (the tree's junction), so a
 * "no storage" answer is invalid for them. One rule, shared by the composer (it
 * coerces a tank) and the question UIs (they disable "no storage").
 */
export const multiSourceNeedsTank = (sources: readonly SourceKind[]): boolean => sources.length >= 2;
