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
        // A metered route can always offer volume: routes that share a meter are
        // mutually exclusive (one flow per meter, see the conflict_mask), so a run's
        // delivered volume is never ambiguous.
        volume: f.metered
          ? { available: true }
          : { available: false, reason: 'needs a flow meter' },
        // Stop-at-level needs a level reading that stays trustworthy while the
        // route runs: a pump that disturbs a non-pump-rated sensor invalidates it,
        // so gate on levelTrusted (presence AND runtime reliability), matching
        // canStopOnFull above rather than presence alone.
        level: levelTrusted
          ? { available: true }
          : {
              available: false,
              reason: f.destHasLevel
                ? 'level sensor is not reliable while the pump runs'
                : 'destination has no level sensor',
            },
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

/** Capabilities from the topology graph route + node lookup. Used by SiteModel. */
export function routeCapabilities(route: Route, nodes: NodeLookup): RouteCapabilities {
  const destTank = asTank(nodes(route.destination));
  const sourceTank = asTank(nodes(route.source));
  // Gravity routes never disturb a level reading; pumped routes trust level only
  // when every level-monitored tank in play is rated to read accurately under a pump.
  const runtimeLevelOk =
    !route.crossesPump || (tankLevelTrustedUnderPump(sourceTank) && tankLevelTrustedUnderPump(destTank));

  return deriveCapabilities({
    runKind: graphRunKind(route),
    metered: route.monitored,
    destHasLevel: !!destTank?.level_monitored,
    destHasFloatValve: !!destTank?.float_valve,
    runtimeLevelOk,
    sourceHasLevel: !!sourceTank?.level_monitored,
  });
}

// ── Manifest adapter (firmware route with pre-baked trait facts) ──────────────

/** Capabilities from a firmware manifest route. Used by the dashboard spec,
 *  automations, the tunable enumeration, and codegen so all agree with SiteModel. */
export function manifestRouteCapabilities(route: ManifestRoute): RouteCapabilities {
  const runKind: RunKind = route.crossesPump ? 'pump' : route.valves.length > 0 ? 'valve' : 'none';
  return deriveCapabilities({
    runKind,
    metered: route.monitored,
    destHasLevel: route.dest_has_level,
    destHasFloatValve: route.dest_has_float_valve,
    runtimeLevelOk: route.runtime_level_ok,
    sourceHasLevel: route.source_has_level,
  });
}
