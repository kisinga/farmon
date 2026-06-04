/**
 * Canonical helpers for tank-level sensing and route automation.
 *
 * Tank level monitoring is intrinsic: a tank with `level_monitored === true`
 * uses its own pressure sensor config (`pressure_pin`, etc.) to derive a
 * level % reading. There are no standalone level_sensor or pressure_sensor
 * nodes.
 *
 * --- Route automation rule ---------------------------------------------------
 *
 * A route is automatable on a level trigger iff its source tank has
 * `level_monitored === true` AND the source tank appears before:
 *   - any of the route's valves, AND
 *   - the route's pump (if the route is pumped)
 *
 * "Before" = lower index in the route's nodeSequence. The constraint exists
 * so the trigger reading isn't disturbed by valves/pumps actuated as part of
 * the route. Only the route's source endpoint qualifies.
 */
/**
 * Subset of `Route` fields needed by `findRouteAutomationSensor`. Both the
 * graph `Route` and the manifest `Route` satisfy this shape, so callers on
 * either side don't need to convert.
 */
export interface RouteForAutomation {
  source: string;
  nodeSequence: string[];
  crossesPump: boolean;
  pumpIndex: number;
}

export interface RouteAutomationSensor {
  /** Tank node id whose level reading drives the trigger. */
  tankId: string;
  /** Sensor node id supplying the level reading (same as tankId for intrinsic). */
  sensorId: string;
}

/** Minimal node shape for findRouteAutomationSensor. */
export interface AutomationNode {
  kind: string;
  [key: string]: unknown;
}

/**
 * Resolve the sensor a level-trigger automation on this route should reference,
 * applying the route automation rule above. Returns `null` if the route has no
 * eligible tank — the route is not automatable on level.
 *
 * @param route     Route to evaluate.
 * @param nodeById  Map of every node id to its node (TopologyNode or manifest node).
 */
export function findRouteAutomationSensor(
  route: RouteForAutomation,
  nodeById: Map<string, AutomationNode>,
): RouteAutomationSensor | null {
  // Source endpoint must be a tank — water_source routes can't carry a level
  // trigger because they have no tank-level reading to fire on.
  const srcNode = nodeById.get(route.source);
  if (!srcNode || srcNode.kind !== 'tank') return null;
  if (!srcNode['level_monitored']) return null;

  // Position rule: source tank must sit before any valve, and before the pump
  // if the route is pumped. The source is always at index 0 of nodeSequence,
  // so this reduces to "no valve or pump appears at index 0," which is
  // guaranteed by route construction (a route always starts at a tank or
  // water source, never at a valve/pump). The check is kept explicit so
  // future changes to route shape don't silently break the invariant.
  for (let i = 0; i < route.nodeSequence.length; i++) {
    const node = nodeById.get(route.nodeSequence[i]);
    if (!node) break;
    if (node.kind === 'valve') break;
    if (route.crossesPump && i === route.pumpIndex) break;
    if (route.nodeSequence[i] === route.source) {
      return { tankId: route.source, sensorId: route.source };
    }
  }
  return null;
}
