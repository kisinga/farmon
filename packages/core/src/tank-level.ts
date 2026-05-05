/**
 * Canonical helpers for tank-level sensing and route automation.
 *
 * --- Tank level invariant ----------------------------------------------------
 *
 * A tank's level reading comes from one of two downstream sensor kinds,
 * connected to the tank in the active topology graph:
 *
 *   - level_sensor    — direct % reading from an ADC (preferred when present)
 *   - pressure_sensor — % derived from pressure-vs-calibration
 *
 * `resolveTankLevelSources` walks the graph once and returns a map keyed by
 * tank id. When both kinds are present on the same tank, level_sensor wins.
 *
 * This is the single source of truth shared by:
 *   - manifest construction (tank annotation)
 *   - codegen (firmware tank-level dispatch)
 *   - automation triggers (route → sensor resolution)
 *   - UI route-level info (which override fields are visible)
 *
 * --- Route automation rule ---------------------------------------------------
 *
 * A route is automatable on a level trigger iff its source tank has a level
 * source AND the source tank appears before:
 *   - any of the route's valves, AND
 *   - the route's pump (if the route is pumped)
 *
 * "Before" = lower index in the route's nodeSequence. The constraint exists
 * so the trigger reading isn't disturbed by valves/pumps actuated as part of
 * the route. Only the route's source endpoint qualifies — destination and
 * mid-route tanks would either sit after a valve (violating the rule) or
 * make no semantic sense as a "fire when level is X" condition.
 *
 * Parallel paths between the same endpoints are distinct Route objects
 * (different `key`); each is automatable independently.
 */
import type { TopologyGraph } from './graph/topology-graph';

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

export interface TankLevelSource {
  id: string;
  kind: 'level_sensor' | 'pressure_sensor';
}

const LEVEL_SOURCE_KINDS = ['level_sensor', 'pressure_sensor'] as const;

/**
 * For each tank in the graph, find the first downstream level source.
 * level_sensor preferred over pressure_sensor when both present.
 */
export function resolveTankLevelSources(
  graph: TopologyGraph,
  nodeKindById: Map<string, string>,
): Map<string, TankLevelSource> {
  const result = new Map<string, TankLevelSource>();
  for (const [id, kind] of nodeKindById) {
    if (kind !== 'tank' || !graph.hasNode(id)) continue;
    for (const wantedKind of LEVEL_SOURCE_KINDS) {
      let found: string | undefined;
      for (const neighbor of graph.outNeighbors(id)) {
        if (graph.hasNode(neighbor) && graph.getNodeAttribute(neighbor, 'kind') === wantedKind) {
          found = neighbor;
          break;
        }
      }
      if (found) {
        result.set(id, { id: found, kind: wantedKind });
        break;
      }
    }
  }
  return result;
}

export interface RouteAutomationSensor {
  /** Tank node id whose level reading drives the trigger. */
  tankId: string;
  /** Sensor node id supplying the level reading. */
  sensorId: string;
  sensorKind: 'level_sensor' | 'pressure_sensor';
}

/**
 * Resolve the sensor a level-trigger automation on this route should reference,
 * applying the route automation rule above. Returns `null` if the route has no
 * eligible tank — the route is not automatable on level.
 *
 * @param route                Route to evaluate.
 * @param tankLevelSourceById  Lookup from `resolveTankLevelSources` (or any
 *                             equivalent map keyed by tank id).
 * @param nodeKindById         Map of every node id to its kind, used to
 *                             identify valves in the sequence.
 */
export function findRouteAutomationSensor(
  route: RouteForAutomation,
  tankLevelSourceById: Map<string, TankLevelSource>,
  nodeKindById: Map<string, string>,
): RouteAutomationSensor | null {
  // Source endpoint must be a tank — water_source routes can't carry a level
  // trigger because they have no tank-level reading to fire on.
  if (nodeKindById.get(route.source) !== 'tank') return null;
  const src = tankLevelSourceById.get(route.source);
  if (!src) return null;

  // Position rule: source tank must sit before any valve, and before the pump
  // if the route is pumped. The source is always at index 0 of nodeSequence,
  // so this reduces to "no valve or pump appears at index 0," which is
  // guaranteed by route construction (a route always starts at a tank or
  // water source, never at a valve/pump). The check is kept explicit so
  // future changes to route shape don't silently break the invariant.
  for (let i = 0; i < route.nodeSequence.length; i++) {
    const kind = nodeKindById.get(route.nodeSequence[i]);
    if (kind === 'valve') break;
    if (route.crossesPump && i === route.pumpIndex) break;
    if (route.nodeSequence[i] === route.source) {
      return { tankId: route.source, sensorId: src.id, sensorKind: src.kind };
    }
  }
  return null;
}
