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
  /** Route's current Source Min %, used to seed a migrated level trigger's threshold. */
  sourceMinPct: number;
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
      out.push({
        controllerId: c.id,
        routeIndex: i,
        routeKey: r.key,
        routeName: r.name,
        routeSetVersion: version,
        monitored: r.monitored,
        hasLevelSource: r.source_has_level,
        sourceMinPct: r.source_min_pct,
      });
    });
  }
  return out;
}

/** The shape written to the `automations` PocketBase collection. */
export interface NewAutomationRow {
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
  override_mask: number;
  ov_source_min_pct: number;
  ov_dest_max_pct: number;
  ov_max_runtime_min: number;
  ov_target_duration_s: number;
  ov_target_volume_l: number;
  enabled: boolean;
}

const DAY_BIT: Record<string, number> = { MON: 0, TUE: 1, WED: 2, THU: 3, FRI: 4, SAT: 5, SUN: 6 };

/** Day tokens (MON..SUN) → days_mask (bit0=MON..bit6=SUN). */
export function daysToMask(days: string[]): number {
  let mask = 0;
  for (const d of days) {
    const b = DAY_BIT[d.toUpperCase().slice(0, 3)];
    if (b !== undefined) mask |= 1 << b;
  }
  return mask;
}

/** "HH:MM" → minutes since midnight (0 on a malformed value). */
export function hmToMin(at: string): number {
  const [h, m] = (at ?? '').split(':').map((n) => parseInt(n, 10));
  if (Number.isNaN(h) || Number.isNaN(m)) return 0;
  return ((h % 24) * 60 + (m % 60) + 1440) % 1440;
}

/**
 * One-time mapping of the legacy `topology.automations[]` onto collection rows.
 * Orphaned routes are dropped (same as the manifest resolver warns+skips). A
 * legacy level trigger fired above the route's Source Min %, so the migrated
 * threshold is seeded from it (the new model carries its own, decoupled). No
 * run-param overrides existed before, so the override fields default to 0/off.
 */
export function topologyAutomationsToRows(topology: SiteTopology, siteId: string): NewAutomationRow[] {
  const byKey = new Map(listAutomatableRoutes(topology).map((r) => [r.routeKey, r]));
  const rows: NewAutomationRow[] = [];
  for (const a of topology.automations ?? []) {
    const r = byKey.get(a.route);
    if (!r) continue;
    rows.push({
      site: siteId,
      controller: r.controllerId,
      name: a.name,
      route_key: a.route,
      route_index: r.routeIndex,
      route_set_version: r.routeSetVersion,
      trigger_type: a.trigger.type,
      time_min: a.trigger.type === 'time' ? hmToMin(a.trigger.at) : 0,
      days_mask: daysToMask(a.days_of_week),
      level_threshold_pct: a.trigger.type === 'level' ? r.sourceMinPct : 0,
      override_mask: 0,
      ov_source_min_pct: 0,
      ov_dest_max_pct: 0,
      ov_max_runtime_min: 0,
      ov_target_duration_s: 0,
      ov_target_volume_l: 0,
      enabled: a.enabled,
    });
  }
  return rows;
}
