/**
 * Usage roll-up by endpoint — the agreed attribution model: water is attributed to
 * the recipient endpoint, summed across whatever routes delivered to it.
 *
 * The runs ledger stays route-keyed (counters are per-meter-per-route); this is a
 * pure presentation roll-up over ledger rows. The caller supplies the
 * route -> endpoint resolver (in the dashboard: findRoute + RouteControl.caps so the
 * key is the stable endpoint node id and the name is the resolved endpoint label).
 *
 * Caveats baked into the result rather than hidden:
 *  - unmetered runs (delivered_l null) contribute to run count + duration only,
 *    never a phantom 0 L (tracked separately as meteredRuns).
 *  - if any contributing route's meter is shared (not volume-attributable), the
 *    endpoint's litres can double-count a shared segment; `attributable` flags it so
 *    the UI can footnote rather than silently mislead.
 *  - a multi-hop delivery through a buffer tank attributes each leg to its immediate
 *    endpoint (the mid tank, then the final endpoint); "by endpoint" means the
 *    immediate recipient, not the ultimate one.
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

/** What a route resolves to for attribution: the endpoint node id (stable key), a
 *  display name, and whether that route's volume is cleanly attributable. */
export interface ResolvedEndpoint {
  id: string;
  name: string;
  attributable?: boolean;
}

/** Aggregated usage for one endpoint over the queried runs. */
export interface EndpointUsage {
  endpointId: string;
  name: string;
  /** Runs delivered to this endpoint (metered + unmetered). */
  runs: number;
  /** Runs that carried a delivered-volume reading. */
  meteredRuns: number;
  /** Sum of delivered litres (metered runs only). */
  litres: number;
  /** Sum of run durations (seconds). */
  duration_s: number;
  /** False when any contributing route's meter is shared, so `litres` may double-count. */
  attributable: boolean;
}

/**
 * Roll up ledger runs by their destination endpoint. Unresolved routes (e.g. a stale
 * route index after a topology change) fall into a per-route bucket so their usage is
 * never silently dropped. Sorted by litres (desc), then duration.
 */
export function rollupUsageByEndpoint(
  runs: readonly UsageRunLike[],
  resolve: (controller: string, route: number) => ResolvedEndpoint | undefined,
): EndpointUsage[] {
  const byEndpoint = new Map<string, EndpointUsage>();
  for (const r of runs) {
    const ep = resolve(r.controller, r.route);
    const id = ep?.id ?? `route:${r.controller}:${r.route}`;
    const name = ep?.name ?? `route ${r.route}`;
    let agg = byEndpoint.get(id);
    if (!agg) {
      agg = { endpointId: id, name, runs: 0, meteredRuns: 0, litres: 0, duration_s: 0, attributable: true };
      byEndpoint.set(id, agg);
    }
    agg.runs += 1;
    agg.duration_s += Number.isFinite(r.duration_s) ? r.duration_s : 0;
    if (r.metered && r.delivered_l != null && Number.isFinite(r.delivered_l)) {
      agg.litres += r.delivered_l;
      agg.meteredRuns += 1;
    }
    if (ep && ep.attributable === false) agg.attributable = false;
  }
  return [...byEndpoint.values()].sort((a, b) => b.litres - a.litres || b.duration_s - a.duration_s);
}
