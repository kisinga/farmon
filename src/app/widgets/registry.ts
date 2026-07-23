/**
 * Widget registry primitives — pure TS, no Angular imports, unit-testable.
 *
 * Every widget the dashboard can render is described once by a {@link WidgetDef}
 * (the concrete table lives in `src/app/pages/dashboard/widget-defs.ts`). The
 * registry answers "may this site see it?" (entitlement filtering) and "may this
 * build see it?" (the device build drops cloud-only widgets); the layout module
 * answers "where does it go?".
 */

export interface WidgetDef {
  /** Stable id: 'tank', 'route-card', 'live-map', 'usage-totals', 'health-history', … */
  id: string;
  title: string;
  /** Entitlement key required (e.g. 'tenant_billing'); absent = always allowed. */
  capability?: string;
  /** Cloud-only widget (history charts, usage totals, health history) — the
   *  device build has no backing endpoint for it, so it filters out there. */
  cloudOnly?: boolean;
  defaultVisible: boolean;
  /** Of 12 grid columns: 4 = ⅓, 6 = ½, 12 = full. */
  defaultWidth: 4 | 6 | 12;
}

/**
 * Drop defs whose `capability` is not in the site's granted capability set.
 * Defs without a capability always pass. An empty/failed capability set
 * therefore hides every entitled widget but never the baseline ones.
 */
export function filterByEntitlement(defs: WidgetDef[], capabilities: string[]): WidgetDef[] {
  const granted = new Set(capabilities);
  return defs.filter((d) => !d.capability || granted.has(d.capability));
}

/**
 * Drop `cloudOnly` defs in the device build — one filter point replacing the
 * old dashboard's scattered `@if (!deviceMode)` template branches. On the
 * cloud build every def passes.
 */
export function filterForBuild(defs: WidgetDef[], deviceMode: boolean): WidgetDef[] {
  return deviceMode ? defs.filter((d) => !d.cloudOnly) : defs;
}

/** id → def lookup, for resolving a layout item's def without rescanning. */
export function defsById(defs: WidgetDef[]): Map<string, WidgetDef> {
  return new Map(defs.map((d) => [d.id, d]));
}
