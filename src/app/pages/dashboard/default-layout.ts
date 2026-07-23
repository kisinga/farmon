/**
 * The auto-derived default layout for the dashboard shell — pure TS,
 * unit-testable. Maps the `buildDashboardSpec` output into ordered
 * {@link LayoutItem}s across zones that each answer ONE operator question,
 * in importance order:
 *
 *   Routes            — "is water flowing, and what can I start/stop?": route
 *                       cards, the app's verbs. Always first.
 *   Map               — "where is everything?": the live topology. Desktop
 *                       (`!opts.mobile`) only — hidden on phone.
 *   Status & controls — "how are the nodes, and what needs a manual nudge?":
 *                       tank levels, valves and pumps in ONE zone (status and
 *                       manual control are two views of the same node). On
 *                       desktop these are DEFAULT-HIDDEN — the map already
 *                       shows levels and valve states (the old dashboard's
 *                       MAP_ABSORBS rule); on phone they're visible, standing
 *                       in for the hidden map. The picker can always un-hide.
 *   Usage             — "how much water did we use?": consumption totals (the
 *                       daily reporting question) at FULL WIDTH on its own
 *                       line, plus the tenant-billing widgets (outstanding
 *                       debt, meter valves) when the site has the capability.
 *   System            — "what happened / is it healthy?": the activity feed,
 *                       full-width and BELOW consumption — a feed, not a
 *                       headline.
 *   Trends            — live flow/pressure RATE charts: movement, which is
 *                       NOT usage. Diagnostics: shown by default, last of the
 *                       content zones. Device health history always comes
 *                       after everything, hidden until asked for.
 *
 * Zones are also VISUAL hierarchy, not just order: primary reporting widgets
 * (usage, activity) take full-width lines of their own; peer diagnostics
 * (trends, billing) pair at half width. Equal weights side-by-side are only
 * for true peers.
 *
 * Every item carries its zone label in `section`, derived from
 * {@link WIDGET_ZONE}; the grid renders it as a section header when the zone
 * changes, for stored layouts too (the shell re-derives sections at render
 * time — labels are a function of the widget, never stored state).
 *
 * Widgets the header / controller-health panel absorb (system-state badges,
 * queue-depth stats, gauges) are intentionally NOT laid out. The shell passes
 * the entitlement- and build-filtered def table, so a def missing from `defs`
 * produces no instance.
 */
import type { DashboardSpec, DashboardWidget, RouteControl } from '@core';
import { defsById, type WidgetDef } from '../../widgets/registry';
import type { LayoutItem } from '../../widgets/layout';
import {
  BILLING_OUTSTANDING_INSTANCE,
  HEALTH_INSTANCE,
  MAP_INSTANCE,
  METER_VALVE_INSTANCE,
  USAGE_INSTANCE,
  routeInstanceId,
  widgetInstanceId,
} from './widget-defs';

/** def id → zone label. The ONE place zone membership is defined — the default
 *  layout emits it and the shell re-derives it for stored layouts, so zone
 *  headers can never drift from the widget's identity. */
export const WIDGET_ZONE: Record<string, string> = {
  'route-card': 'Routes',
  'live-map': 'Map',
  'tank': 'Status & controls',
  'valve': 'Status & controls',
  'badge': 'Status & controls',
  'gauge': 'Status & controls',
  'usage-totals': 'Usage',
  'billing-outstanding': 'Usage',
  'meter-valve': 'Usage',
  'timeline': 'System',
  'health-history': 'System',
  // Movement (live flow/pressure RATE) is Trends; consumption (cumulative
  // totals) is Usage — the two are never the same zone.
  'flow': 'Trends',
  'line': 'Trends',
  'stat': 'Usage',
};

/** Monitor-only = no actuator to control (mirrors the old dashboard's split;
 *  missing caps — non-spec literals — default to controllable). */
function isMonitorOnly(r: RouteControl): boolean {
  return r.caps !== undefined && !r.caps.runnable;
}

export function buildDefaultLayout(
  spec: DashboardSpec,
  defs: WidgetDef[],
  opts: { mobile?: boolean } = {},
): LayoutItem[] {
  const byId = defsById(defs);
  const items: LayoutItem[] = [];
  const put = (widgetId: string, instanceId: string, forceHidden = false): void => {
    const def = byId.get(widgetId);
    if (!def) return; // unknown or entitlement-filtered def → no instance
    items.push({ widgetId, instanceId, w: def.defaultWidth, hidden: forceHidden || !def.defaultVisible, section: WIDGET_ZONE[widgetId] });
  };

  // --- Routes: "is water flowing, and what can I start/stop?" -----------------
  const routes = spec.controllers.flatMap((c) => c.routes.map((r) => ({ controller: c.controller, route: r })));
  const anyRunnable = routes.some(({ route }) => !isMonitorOnly(route));
  // Monitor-only routes default-hidden, mirroring the old dashboard's collapsed
  // "monitor only" group — except when nothing is runnable: hiding them all
  // would leave an empty Routes zone, so the old dashboard force-shows them.
  for (const { controller, route } of routes) {
    put('route-card', routeInstanceId(controller, route.routeId), isMonitorOnly(route) && anyRunnable);
  }

  // --- Map: the topology — desktop only; the node cards substitute on phone ---
  if (spec.controllers.length) put('live-map', MAP_INSTANCE, !!opts.mobile);

  // --- Status & controls: tanks, valves, pumps in ONE zone. On desktop the
  //     map already shows levels and valve states (the old MAP_ABSORBS rule),
  //     so these start hidden there; on phone they're the topology substitute.
  const nodesHidden = !opts.mobile;
  for (const w of spec.widgets) if (w.kind === 'tank') put('tank', widgetInstanceId(w), nodesHidden);
  const actuatorKeys = new Set<string>();
  for (const c of spec.controllers) for (const a of c.actuators) actuatorKeys.add(`${c.controller}/${a.reportedSensor}`);
  const isControl = (w: DashboardWidget): boolean =>
    w.kind === 'valve' || (!!w.sensor && actuatorKeys.has(`${w.controller}/${w.sensor}`));
  for (const w of spec.widgets) if (isControl(w)) put(w.kind === 'valve' ? 'valve' : 'badge', widgetInstanceId(w), nodesHidden);

  // --- Usage: consumption is the daily question ("how much water did we use?"),
  //     full-width on its own line. Tenant-billing widgets pair beside it:
  //     site-level (not route-bound), so they emit even on a route-less site —
  //     but only when the registry kept the defs (tenant_billing capability
  //     granted, cloud build); `put` no-ops otherwise.
  if (routes.length) put('usage-totals', USAGE_INSTANCE);
  put('billing-outstanding', BILLING_OUTSTANDING_INSTANCE);
  put('meter-valve', METER_VALVE_INSTANCE);
  // A stray cumulative flow total is CONSUMPTION (total litres used), not a
  // trend — it lives here. Usage, not movement.
  for (const w of spec.widgets) if (w.kind === 'stat' && w.unit === 'L') put('stat', widgetInstanceId(w));

  // --- System: "what happened / is it healthy?" — the activity feed full-width
  //     on its own line, BELOW consumption: a feed, not a headline.
  for (const w of spec.widgets) if (w.kind === 'timeline') put('timeline', widgetInstanceId(w));

  // --- Trends: live flow/pressure RATE charts are movement, not usage —
  //     diagnostics, shown by default but last of the content zones.
  for (const w of spec.widgets) {
    if (w.kind === 'flow' || w.kind === 'line') put(w.kind, widgetInstanceId(w));
  }

  // --- Health history is ALWAYS last — below every content zone.
  put('health-history', HEALTH_INSTANCE); // defaultVisible: false → starts hidden

  return items;
}
