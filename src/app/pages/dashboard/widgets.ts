/**
 * Layout item → render instruction. The shell's per-item template switch
 * consumes this discriminated union; `null` means the instance has no live
 * subject (e.g. a stored layout entry for a since-removed route) and renders
 * nothing. Pure TS — the resolution logic is Angular-free.
 */
import type { ControllerControls, DashboardSpec, DashboardWidget, RouteControl } from '@core';
import { defsById, type WidgetDef } from '../../widgets/registry';
import type { LayoutItem } from '../../widgets/layout';
import {
  BILLING_OUTSTANDING_INSTANCE,
  HEALTH_INSTANCE,
  MAP_INSTANCE,
  METER_VALVE_INSTANCE,
  USAGE_INSTANCE,
  isRouteInstance,
  isWidgetInstance,
  routeFromInstance,
  widgetIdFromInstance,
} from './widget-defs';

export type WidgetRender =
  | { def: WidgetDef; kind: 'telemetry'; widget: DashboardWidget }
  | { def: WidgetDef; kind: 'route'; route: RouteControl; controller: ControllerControls }
  | { def: WidgetDef; kind: 'map' }
  | { def: WidgetDef; kind: 'usage' }
  | { def: WidgetDef; kind: 'health' }
  | { def: WidgetDef; kind: 'billing-outstanding' }
  | { def: WidgetDef; kind: 'meter-valve' };

export function resolveRender(item: LayoutItem, spec: DashboardSpec, defs: WidgetDef[]): WidgetRender | null {
  const def = defsById(defs).get(item.widgetId);
  if (!def) return null;
  if (item.instanceId === MAP_INSTANCE) return { def, kind: 'map' };
  if (item.instanceId === USAGE_INSTANCE) return { def, kind: 'usage' };
  if (item.instanceId === HEALTH_INSTANCE) return { def, kind: 'health' };
  if (item.instanceId === BILLING_OUTSTANDING_INSTANCE) return { def, kind: 'billing-outstanding' };
  if (item.instanceId === METER_VALVE_INSTANCE) return { def, kind: 'meter-valve' };
  if (isRouteInstance(item.instanceId)) {
    const ref = routeFromInstance(item.instanceId);
    if (!ref) return null;
    const controller = spec.controllers.find((c) => c.controller === ref.controller);
    const route = controller?.routes.find((r) => r.routeId === ref.routeId);
    return controller && route ? { def, kind: 'route', route, controller } : null;
  }
  if (isWidgetInstance(item.instanceId)) {
    const widget = spec.widgets.find((w) => w.id === widgetIdFromInstance(item.instanceId));
    return widget ? { def, kind: 'telemetry', widget } : null;
  }
  return null;
}
