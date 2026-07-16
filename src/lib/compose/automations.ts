/**
 * Default watering automations for a freshly-composed Easy Mode site.
 *
 * Pure planning only: it returns the rows to persist, no I/O. The app layer
 * loops these into AutomationsService.create() after the site exists. Keeping the
 * scheduling logic here makes it testable and keeps the cross-layer surface thin.
 *
 * Scope: irrigation-style sites (farm, greenhouse) get one daily window per
 * demand zone, staggered so the sequential manifold never overlaps. Every other
 * vertical gets none — auto-watering a kiosk or a house would be wrong. The
 * firmware's per-route safety (the route_overrides the composer emits, plus the
 * 1800 s max-runtime backstop) stops each run; the schedule only starts it.
 */
import { listAutomatableRoutes, type NewAutomationRow } from '../automation-routes';
import { parseRouteKey } from '../graph/routes';
import type { SiteTopology } from '../topology.types';
import type { Vertical } from './catalog';

/** Verticals that get a default watering schedule. */
const IRRIGATION: ReadonlySet<Vertical> = new Set<Vertical>(['farm', 'greenhouse']);

/** First window starts at 06:00 site-local time (03:00 UTC = 180); each zone gets its own non-overlapping slot. */
const FIRST_WINDOW_MIN = 3 * 60;
const WINDOW_MINUTES = 60;
const MINUTES_PER_DAY = 24 * 60;

/**
 * Plan staggered daily watering for a composed topology's demand zones.
 *
 * A demand (draw) route is one whose destination is an endpoint. Each gets a
 * time-triggered automation with no run-parameter overrides (override_mask 0), so
 * the route's own safe defaults govern the run; the windows are spaced by
 * WINDOW_MINUTES, comfortably wider than the route's max-runtime backstop.
 */
export function planWateringAutomations(
  topology: SiteTopology,
  siteId: string,
  vertical: Vertical,
): NewAutomationRow[] {
  if (!IRRIGATION.has(vertical)) return [];

  const kindById = new Map(topology.nodes.map(n => [n.id, n.kind]));
  const demand = listAutomatableRoutes(topology).filter(
    r => kindById.get(parseRouteKey(r.routeKey).destination) === 'endpoint',
  );

  return demand.map((r, i) => ({
    site: siteId,
    controller: r.controllerId,
    name: `${r.routeName} - daily`,
    route_key: r.routeKey,
    route_index: r.routeIndex,
    route_set_version: r.routeSetVersion,
    trigger_type: 'time',
    time_min: (FIRST_WINDOW_MIN + i * WINDOW_MINUTES) % MINUTES_PER_DAY,
    days_mask: 0, // every day
    level_threshold_pct: 50,
    override_mask: 0, // use the route's own safe defaults
    ov_source_min_pct: 0,
    ov_dest_max_pct: 0,
    ov_max_runtime_min: 30,
    ov_target_duration_s: 0,
    ov_target_volume_l: 0,
    enabled: true,
  }));
}
