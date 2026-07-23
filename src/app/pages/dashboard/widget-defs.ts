/**
 * The concrete widget-def table for the site dashboard — pure TS (no Angular)
 * so the tsx unit tests can import it directly.
 *
 * Every `WidgetKind` emitted by `buildDashboardSpec` maps to a def here by id
 * (gauge/tank/line/stat/badge/timeline/valve/flow), plus the structural
 * widgets the spec doesn't enumerate (live map, route cards, usage totals,
 * health history). The golden layout test asserts the kind coverage.
 */
import type { DashboardWidget } from '@core';
import type { WidgetDef } from '../../widgets/registry';

export const WIDGET_DEFS: WidgetDef[] = [
  // Structural widgets.
  { id: 'live-map', title: 'System map', defaultVisible: true, defaultWidth: 12 },
  { id: 'route-card', title: 'Route', defaultVisible: true, defaultWidth: 4 },
  // Cloud-only: the /usage facade has no device endpoint. Full width on its own
  // line — consumption is the daily reporting headline, never a half-card peer.
  { id: 'usage-totals', title: 'Water usage', defaultVisible: true, defaultWidth: 12, cloudOnly: true },
  // Cloud-only: the device keeps no telemetry tiers to chart health from.
  { id: 'health-history', title: 'Device health', defaultVisible: false, defaultWidth: 12, cloudOnly: true },
  // Cloud-only + entitled: tenant billing lives in PocketBase / the billing API,
  // neither of which the device build can reach.
  { id: 'billing-outstanding', title: 'Billing outstanding', capability: 'tenant_billing', cloudOnly: true, defaultVisible: true, defaultWidth: 6 },
  { id: 'meter-valve', title: 'Meter valves', capability: 'tenant_billing', cloudOnly: true, defaultVisible: true, defaultWidth: 6 },
  // Telemetry widgets — one def per WidgetKind from src/lib/dashboard-spec.ts.
  { id: 'tank', title: 'Tank level', defaultVisible: true, defaultWidth: 4 },
  { id: 'valve', title: 'Valve', defaultVisible: true, defaultWidth: 4 },
  { id: 'badge', title: 'Status', defaultVisible: true, defaultWidth: 4 },
  { id: 'gauge', title: 'Gauge', defaultVisible: true, defaultWidth: 4 },
  // A stray cumulative flow total is consumption (Usage zone), not movement —
  // hidden by default, the usage facade already answers the question better.
  { id: 'stat', title: 'Reading', defaultVisible: false, defaultWidth: 6 },
  // Trends (live flow/pressure RATE = movement) are diagnostics — they sit
  // LAST (below consumption and activity), shown by default. Cloud-only:
  // history charts read the telemetry tiers, which don't exist on the device
  // (echarts never loads there).
  { id: 'flow', title: 'Flow rate', defaultVisible: true, defaultWidth: 6, cloudOnly: true },
  { id: 'line', title: 'Pressure trend', defaultVisible: true, defaultWidth: 6, cloudOnly: true },
  // The activity feed: full-width on its own line, below consumption — a feed,
  // not a headline.
  { id: 'timeline', title: 'Activity', defaultVisible: true, defaultWidth: 12 },
];

/** Instance ids — stable across loads so a stored layout keeps matching. */
export const MAP_INSTANCE = 'live-map';
export const USAGE_INSTANCE = 'usage-totals';
export const HEALTH_INSTANCE = 'health-history';
export const BILLING_OUTSTANDING_INSTANCE = 'billing-outstanding';
export const METER_VALVE_INSTANCE = 'meter-valve';
const WIDGET_PREFIX = 'widget/';
const ROUTE_PREFIX = 'route/';

export function widgetInstanceId(w: DashboardWidget): string {
  return `${WIDGET_PREFIX}${w.id}`; // w.id === `${controller}/${sensor}`
}

export function routeInstanceId(controller: string, routeId: number): string {
  return `${ROUTE_PREFIX}${controller}/${routeId}`;
}

export function isWidgetInstance(instanceId: string): boolean {
  return instanceId.startsWith(WIDGET_PREFIX);
}

export function widgetIdFromInstance(instanceId: string): string {
  return instanceId.slice(WIDGET_PREFIX.length);
}

export function isRouteInstance(instanceId: string): boolean {
  return instanceId.startsWith(ROUTE_PREFIX);
}

export function routeFromInstance(instanceId: string): { controller: string; routeId: number } | null {
  const rest = instanceId.slice(ROUTE_PREFIX.length);
  const slash = rest.lastIndexOf('/');
  if (slash < 0) return null;
  const routeId = Number(rest.slice(slash + 1));
  return Number.isInteger(routeId) ? { controller: rest.slice(0, slash), routeId } : null;
}
