/**
 * Browser-side route resolution for automations. Route derivation is browser-only
 * (topologyToManifestForController), so the browser stamps each automation row with
 * its owning controller, its route_index into that controller's baked route table,
 * and the route_set_version — the server then serializes the rows verbatim and the
 * device self-validates. This module is that resolver + the one-time mapping of the
 * legacy in-topology automations onto the new collection rows.
 */
import type { SiteTopology } from './topology.types';
import { topologyToManifestForController } from './topology-to-manifest';
import { routeSetVersion } from './automation-wire';
import { manifestRouteCapabilities, type RouteCapabilities } from './route-capabilities';
import type { StopSpecOverride } from './run-targets';

/** A route an automation can target, with everything the UI + the row need. */
export interface AutomatableRoute {
  controllerId: string;
  routeIndex: number;
  routeKey: string;
  routeName: string;
  routeSetVersion: number;
  /** Has a flow sensor → a volume target is available (and trustworthy). */
  monitored: boolean;
  /** Source is a tank with a level reading → a level trigger is available. */
  hasLevelSource: boolean;
  /** Destination tank capacity (litres), to cap the volume target at the tank — the
   *  same bound the run picker uses (runTargetMax). Undefined for non-tank dests. */
  destCapacityL?: number;
  /** The full capability view from the single owner — the editor gates which
   *  override targets it offers on `caps.targets` so it agrees with the run picker
   *  and the firmware (volume only when attributable, level only with a sensor). */
  caps: RouteCapabilities;
}

/** Every route across every controller, each resolved to its owner + index + version. */
export function listAutomatableRoutes(topology: SiteTopology): AutomatableRoute[] {
  const out: AutomatableRoute[] = [];
  for (const c of topology.controllers) {
    let m;
    try {
      m = topologyToManifestForController(topology, c.id);
    } catch {
      continue; // a controller that fails to resolve contributes no routes
    }
    const version = routeSetVersion(m);
    m.routes.forEach((r, i) => {
      const caps = manifestRouteCapabilities(r);
      if (!caps.runnable) return; // not runnable (no actuator): not automatable
      const destNode = r.destination ? topology.nodes.find((n) => n.id === r.destination) : undefined;
      out.push({
        controllerId: c.id,
        routeIndex: i,
        routeKey: r.key,
        routeName: r.name,
        routeSetVersion: version,
        monitored: r.monitored,
        hasLevelSource: r.source_has_level,
        destCapacityL: (destNode as { capacity_l?: number } | undefined)?.capacity_l,
        caps,
      });
    });
  }
  return out;
}

/** The shape written to the `automations` PocketBase collection. The `override_mask`
 *  + `ov_*` stop-condition fields come from StopSpecOverride — the same shape a
 *  manual targeted run sends — so the two run paths never diverge. */
export interface NewAutomationRow extends StopSpecOverride {
  site: string;
  controller: string;
  name: string;
  route_key: string;
  route_index: number;
  route_set_version: number;
  trigger_type: 'time' | 'level';
  time_min: number;
  days_mask: number;
  level_threshold_pct: number;
  enabled: boolean;
}

