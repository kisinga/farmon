/**
 * Usage roll-up by route — the dashboard's "water used per route, over a duration"
 * view: each route's runs in the window summed into one row (total volume + time +
 * run count). This is the operator view (which route moved how much); the runs
 * ledger itself stays per-run, this is a pure presentation aggregate.
 *
 * Per-route, not per-endpoint: two routes to the same endpoint (e.g. from different
 * sources) stay separate rows so each source's contribution is visible. (Endpoint
 * roll-up remains the billing attribution concept for a future customer view.)
 *
 * Unmetered runs (delivered_l null) contribute to run count + duration only, never
 * a phantom 0 L (tracked separately as meteredRuns).
 */

/** The minimal run shape this roll-up needs (a structural subset of UsageRun, so the
 *  lib stays independent of the app's runtime models). */
export interface UsageRunLike {
  controller: string;
  route: number;
  duration_s: number;
  delivered_l: number | null;
  metered: boolean;
}

/** Aggregated usage for one route over the queried runs. */
export interface RouteUsage {
  controller: string;
  route: number;
  /** Display label, e.g. "Rain Tank > House 2". */
  name: string;
  /** Runs on this route (metered + unmetered). */
  runs: number;
  /** Runs that carried a delivered-volume reading. */
  meteredRuns: number;
  /** Sum of delivered litres (metered runs only). */
  litres: number;
  /** Sum of run durations (seconds). */
  duration_s: number;
}

/**
 * Roll up ledger runs by their route, in the given window. `name` resolves a route's
 * display label from its (controller, route). Sorted by litres (desc), then duration.
 */
export function rollupUsageByRoute(
  runs: readonly UsageRunLike[],
  name: (controller: string, route: number) => string,
): RouteUsage[] {
  const byRoute = new Map<string, RouteUsage>();
  for (const r of runs) {
    const key = `${r.controller}:${r.route}`;
    let agg = byRoute.get(key);
    if (!agg) {
      agg = { controller: r.controller, route: r.route, name: name(r.controller, r.route), runs: 0, meteredRuns: 0, litres: 0, duration_s: 0 };
      byRoute.set(key, agg);
    }
    agg.runs += 1;
    agg.duration_s += Number.isFinite(r.duration_s) ? r.duration_s : 0;
    if (r.metered && r.delivered_l != null && Number.isFinite(r.delivered_l)) {
      agg.litres += r.delivered_l;
      agg.meteredRuns += 1;
    }
  }
  return [...byRoute.values()].sort((a, b) => b.litres - a.litres || b.duration_s - a.duration_s);
}
