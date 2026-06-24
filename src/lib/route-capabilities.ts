/**
 * Route capabilities — the single owner of "what can this route do".
 *
 * Every capability question (is it runnable, is it trackable, which run targets
 * does it offer, what does a flow stall mean, can it stop on full) is answered
 * here, once. The rules live in {@link deriveCapabilities}; two thin adapters feed
 * it facts from the two route representations:
 *   - {@link routeCapabilities}         — from the topology graph `Route` (+ nodes)
 *   - {@link manifestRouteCapabilities} — from the firmware `Manifest` route
 * Both produce identical results because they share the rule core, so the
 * dashboard run picker, the automations editor, the manifest compiler, and the
 * firmware codegen can never disagree (the historical bugs were three separate
 * predicates drifting: `routeVolumeEligible`, `canStopOnFull`, and an ad-hoc
 * `monitoredOnly` check). An agreement test pins the two adapters together.
 *
 * Endpoint identity is the real recipient node (`nodeSequence[last]`), never the
 * manifest's `destination` field — which is `undefined` for every non-tank
 * endpoint (it means "the destination tank"). Keying off the real endpoint is what
 * fixes the metered-route-with-no-volume bug, where two distinct open endpoints
 * both collapsed to `''` and wrongly suppressed each other.
 *
 * Node traits come from the existing entity schemas (`tank.level_monitored`,
 * `tank.float_valve`, `tank.pressure_pump_rated`); this module does not introduce a
 * parallel node hierarchy.
 */
import type { Route } from './graph/routes';
import type { TopologyNode, TankNode } from './topology.types';
import type { Manifest } from './manifest.types';

type ManifestRoute = Manifest['routes'][number];

/** Look up a topology node by id (typically a closure over a Map). */
export type NodeLookup = (id: string) => TopologyNode | undefined;

/** How "run this route" actuates. `none` => not runnable (no actuator on the path). */
export type RunKind = 'pump' | 'valve' | 'none';

/**
 * What a confirmed-then-ceased flow ("stall") means for this route. Endpoint-driven
 * and pump-independent, so a gravity route classifies a stall exactly like its
 * pumped equivalent.
 *  - `full`               : a float valve throttles the inlet shut when full, so a
 *                           stall is a clean "tank full" stop.
 *  - `levelAuthoritative` : the destination level sensor decides full; a stall at/
 *                           above setpoint corroborates it, a stall below setpoint
 *                           is anomalous (a real under-fill, not a benign full).
 *  - `flowLost`           : an open endpoint (or a tank with neither float nor
 *                           level) cannot "be full" via flow; a stall is loss of
 *                           flow, surfaced as a warning rather than a normal stop.
 *  - `n/a`                : no flow sensor, so no stall can be detected.
 */
export type StallDisposition = 'full' | 'levelAuthoritative' | 'flowLost' | 'n/a';

/** Whether a run target is offered, and if not, a short plain-language reason the
 *  UI can show on a disabled control. */
export interface TargetAvailability {
  available: boolean;
  reason?: string;
}

/** The three run targets, each with availability + reason. Other override fields
 *  (max runtime, source min) are schedule-only safety gates, not run targets. */
export interface RouteTargets {
  volume: TargetAvailability;
  duration: TargetAvailability;
  level: TargetAvailability;
}

/** The representation-agnostic facts the capability rules consume. Each adapter
 *  resolves these from its route representation, then calls {@link deriveCapabilities}. */
export interface RouteCapabilityFacts {
  /** Endpoint (recipient) node id = the last node of the path. SSOT for usage. */
  endpointId: string;
  /** Endpoint node kind, when known (graph adapter has it; manifest doesn't). */
  endpointKind?: TopologyNode['kind'];
  /** How a run actuates. */
  runKind: RunKind;
  /** Has at least one flow sensor on the path. */
  metered: boolean;
  /** Destination is a level-monitored tank. */
  destHasLevel: boolean;
  /** Destination tank has a mechanical float valve. */
  destHasFloatValve: boolean;
  /** Level sensors stay reliable while the route runs (gravity, or pump-rated tanks). */
  runtimeLevelOk: boolean;
  /** Source is a level-monitored tank. */
  sourceHasLevel: boolean;
  /** Metered AND no concurrent route reads the same meter for the same endpoint. */
  volumeAttributable: boolean;
}

/** The full capability view of a route. Pure projection of the facts. */
export interface RouteCapabilities extends RouteCapabilityFacts {
  /** Has a commandable actuator (valve or pump). Only runnable routes get a Start. */
  runnable: boolean;
  /** Has something to measure: a flow sensor, or a level-monitored destination tank. */
  trackable: boolean;
  /** The device can detect a full destination and stop cleanly without a target. */
  canStopOnFull: boolean;
  /** What a flow stall means for this route. */
  stallDisposition: StallDisposition;
  /** Which run targets this route offers (with reasons when not). */
  targets: RouteTargets;
}

const NO_ACTUATOR = 'route has no actuator to run';

/** The rule core. One owner of every capability decision. */
export function deriveCapabilities(f: RouteCapabilityFacts): RouteCapabilities {
  const runnable = f.runKind !== 'none';
  const trackable = f.metered || f.destHasLevel;
  const levelTrusted = f.destHasLevel && f.runtimeLevelOk;

  const canStopOnFull = levelTrusted || (f.metered && f.destHasFloatValve);

  // Precedence: a direct level measurement beats the float-stall inference, so a
  // tank that is both level-monitored and float-fitted classifies as level.
  const stallDisposition: StallDisposition = !f.metered
    ? 'n/a'
    : levelTrusted
      ? 'levelAuthoritative'
      : f.destHasFloatValve
        ? 'full'
        : 'flowLost';

  const targets: RouteTargets = runnable
    ? {
        duration: { available: true },
        volume: !f.metered
          ? { available: false, reason: 'needs a flow meter' }
          : f.volumeAttributable
            ? { available: true }
            : { available: false, reason: 'meter is shared with a concurrent route to this endpoint' },
        level: f.destHasLevel
          ? { available: true }
          : { available: false, reason: 'destination has no level sensor' },
      }
    : {
        duration: { available: false, reason: NO_ACTUATOR },
        volume: { available: false, reason: NO_ACTUATOR },
        level: { available: false, reason: NO_ACTUATOR },
      };

  return { ...f, runnable, trackable, canStopOnFull, stallDisposition, targets };
}

// ── Graph adapter (topology Route + node traits) ──────────────────────────────

function asTank(node: TopologyNode | undefined): TankNode | undefined {
  return node && node.kind === 'tank' ? (node as TankNode) : undefined;
}

/** A level reading is trustworthy under a pump when there is no level reading at
 *  all, or the tank's sensor is rated to stay accurate while a pump runs. */
function tankLevelTrustedUnderPump(tank: TankNode | undefined): boolean {
  if (!tank || !tank.level_monitored) return true;
  return !!tank.pressure_pump_rated;
}

function graphRunKind(route: Route): RunKind {
  return route.crossesPump ? 'pump' : route.valves.length > 0 ? 'valve' : 'none';
}

/**
 * Whether a graph route may expose a volume target: it is metered AND no sibling
 * can read the same meter concurrently for the same endpoint. Keys on the real
 * endpoint node id (`route.destination` is the real endpoint at the graph level),
 * which is the fix for the prior `destination ?? ''` collapse.
 */
export function routeVolumeAttributable(route: Route, allRoutes: readonly Route[]): boolean {
  if (!route.monitored) return false;
  const meter = route.flowSensors[0];
  if (!meter) return false;
  return !allRoutes.some(
    (o) => o.key !== route.key && o.flowSensors[0] === meter && o.destination === route.destination,
  );
}

/** Capabilities from the topology graph route + node lookup. Used by SiteModel. */
export function routeCapabilities(
  route: Route,
  nodes: NodeLookup,
  allRoutes: readonly Route[],
): RouteCapabilities {
  const destTank = asTank(nodes(route.destination));
  const sourceTank = asTank(nodes(route.source));
  // Gravity routes never disturb a level reading; pumped routes trust level only
  // when every level-monitored tank in play is rated to read accurately under a pump.
  const runtimeLevelOk =
    !route.crossesPump || (tankLevelTrustedUnderPump(sourceTank) && tankLevelTrustedUnderPump(destTank));

  return deriveCapabilities({
    endpointId: route.destination,
    endpointKind: route.destKind,
    runKind: graphRunKind(route),
    metered: route.monitored,
    destHasLevel: !!destTank?.level_monitored,
    destHasFloatValve: !!destTank?.float_valve,
    runtimeLevelOk,
    sourceHasLevel: !!sourceTank?.level_monitored,
    volumeAttributable: routeVolumeAttributable(route, allRoutes),
  });
}

// ── Manifest adapter (firmware route with pre-baked trait facts) ──────────────

/** The real endpoint id for a manifest route: the last path node, not the
 *  `destination` field (which is the dest *tank*, undefined for open endpoints). */
function manifestEndpointId(route: ManifestRoute): string {
  const seq = route.nodeSequence;
  return (seq && seq.length ? seq[seq.length - 1] : route.destination) ?? '';
}

/** Manifest-route counterpart of {@link routeVolumeAttributable}, keyed on the real
 *  endpoint so distinct open endpoints sharing a meter stay attributable. */
export function manifestRouteVolumeAttributable(
  route: ManifestRoute,
  allRoutes: readonly ManifestRoute[],
): boolean {
  if (!route.monitored || !route.flow_sensor) return false;
  const ep = manifestEndpointId(route);
  return !allRoutes.some(
    (o) => o.key !== route.key && o.flow_sensor === route.flow_sensor && manifestEndpointId(o) === ep,
  );
}

/** Capabilities from a firmware manifest route. Used by the dashboard spec,
 *  automations, the tunable enumeration, and codegen so all agree with SiteModel. */
export function manifestRouteCapabilities(
  route: ManifestRoute,
  allRoutes: readonly ManifestRoute[],
): RouteCapabilities {
  const runKind: RunKind = route.crossesPump ? 'pump' : route.valves.length > 0 ? 'valve' : 'none';
  return deriveCapabilities({
    endpointId: manifestEndpointId(route),
    runKind,
    metered: route.monitored,
    destHasLevel: route.dest_has_level,
    destHasFloatValve: route.dest_has_float_valve,
    runtimeLevelOk: route.runtime_level_ok,
    sourceHasLevel: route.source_has_level,
    volumeAttributable: manifestRouteVolumeAttributable(route, allRoutes),
  });
}
