/**
 * Default-layout derivation (src/app/pages/dashboard/default-layout.ts):
 * every WidgetKind the spec emits maps to a registry def; zones order
 * Routes → Map → Status & controls → Usage → System → Trends, with health
 * history always last; the map is desktop-only and the node cards are its
 * phone substitute (hidden on desktop — the old MAP_ABSORBS rule);
 * monitor-only routes and health-history start hidden; the device build's
 * cloudOnly filter drops the chart/usage/health/billing instances; the
 * billing widgets are entitlement-gated on `tenant_billing`.
 *
 * Usage: npx tsx test/dashboard-default-layout.test.ts
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { parse as parseYaml } from "yaml";
import {
  parseTopology,
  buildDashboardSpec,
  type DashboardSpec,
  type RouteCapabilities,
} from "@core";
import { buildDefaultLayout } from "../src/app/pages/dashboard/default-layout";
import { WIDGET_DEFS } from "../src/app/pages/dashboard/widget-defs";
import { filterByEntitlement, filterForBuild } from "../src/app/widgets/registry";
import type { LayoutItem } from "../src/app/widgets/layout";

const CONFIG_PATH = path.resolve(new URL(".", import.meta.url).pathname, "..", "defaults/configs/pump-controller.yaml");

let passed = 0;
let failed = 0;
function assert(condition: boolean, name: string, detail?: string) {
  if (condition) { console.log(`  ✓ ${name}`); passed++; }
  else { console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`); failed++; }
}

console.log("Dashboard default layout");
console.log("========================\n");

const raw = parseYaml(fs.readFileSync(CONFIG_PATH, "utf-8")) as Record<string, unknown>;
const spec = buildDashboardSpec(parseTopology(raw));
const layout = buildDefaultLayout(spec, WIDGET_DEFS);
const idx = (instanceId: string) => layout.findIndex((i) => i.instanceId === instanceId);
const idx2 = (l: LayoutItem[], instanceId: string) => l.findIndex((i) => i.instanceId === instanceId);

// --- Fixture sanity (so the ordering assertions below aren't vacuous) ---------
console.log("Fixture:");
assert(spec.controllers.length === 1, `fixture has 1 controller (got ${spec.controllers.length})`);
const routes = spec.controllers.flatMap((c) => c.routes);
assert(routes.length > 0, `fixture derives routes (got ${routes.length})`);
assert(spec.widgets.some((w) => w.kind === "tank"), "fixture derives tank widgets");
assert(spec.widgets.some((w) => w.kind === "timeline"), "fixture derives a timeline widget");

// --- Kind coverage: every emitted WidgetKind maps to a registry def ------------
console.log("\nKind coverage:");
const kinds = new Set(spec.widgets.map((w) => w.kind));
for (const kind of kinds) {
  assert(WIDGET_DEFS.some((d) => d.id === kind), `WidgetKind '${kind}' has a registry def`);
}

// --- Zone ordering: Routes → Map → Status & controls → Usage → System → Trends -
console.log("\nZone ordering:");
const firstRoute = layout.findIndex((i) => i.widgetId === "route-card");
assert(firstRoute === 0, "route cards open the layout (Routes zone first)");
const lastRoute = Math.max(...layout.map((i, n) => (i.widgetId === "route-card" ? n : -1)));
const mapIdx = idx("live-map");
assert(mapIdx > lastRoute, "the map comes right after the routes");
const nodeIdxs = layout
  .map((i, n) => (i.section === "Status & controls" ? n : -1))
  .filter((n) => n >= 0);
assert(nodeIdxs.length > 0, "fixture derives node (status & control) widgets");
const firstNode = Math.min(...nodeIdxs);
assert(firstNode > mapIdx, "node status & controls come after the map");
const usageIdx = idx("usage-totals");
assert(usageIdx > Math.max(...nodeIdxs), "consumption (usage) comes right after the node zone");
const outstandingIdx = idx("billing-outstanding");
const meterValveIdx = idx("meter-valve");
assert(outstandingIdx === usageIdx + 1, "billing-outstanding lands right after usage-totals in the Usage zone");
assert(meterValveIdx === outstandingIdx + 1, "meter-valve lands right after billing-outstanding in the Usage zone");
const firstTimeline = layout.findIndex((i) => i.widgetId === "timeline");
assert(firstTimeline > meterValveIdx, "activity timelines come after the Usage zone");
// Trends sit after the System zone, and device health history is ALWAYS last.
const trendIdxs = layout.map((i, n) => (i.section === "Trends" ? n : -1)).filter((n) => n >= 0);
const healthIdx = idx("health-history");
if (trendIdxs.length) {
  assert(Math.min(...trendIdxs) > firstTimeline, "trend charts come after the activity timelines");
  assert(healthIdx > Math.max(...trendIdxs), "health history comes after the trend charts");
}
assert(healthIdx === layout.length - 1, "health history is always the last item");

// --- Section labels ------------------------------------------------------------
console.log("\nSections:");
assert(layout[0].section === "Routes", "first zone is labelled Routes");
assert(layout[mapIdx].section === "Map", "the map carries the Map section");
assert(layout[firstNode].section === "Status & controls", "nodes carry the Status & controls section");
assert(layout[usageIdx].section === "Usage", "usage totals carry the Usage section");
assert(layout[outstandingIdx].section === "Usage" && layout[meterValveIdx].section === "Usage",
  "billing widgets carry the Usage section");
assert(layout[firstTimeline].section === "System", "timelines carry the System section");
if (trendIdxs.length) assert(layout[trendIdxs[0]].section === "Trends", "trend charts carry the Trends section");
// Usage ≠ movement: a stray cumulative flow total is consumption, never a trend.
const strayStat = layout.find((i) => i.widgetId === "stat");
if (strayStat) assert(strayStat.section === "Usage", "cumulative flow total lives in Usage, not Trends");

// --- Default visibility ------------------------------------------------------------
console.log("\nDefault visibility:");
const monitorRoutes = routes.filter((r) => r.caps !== undefined && !r.caps.runnable);
const anyRunnable = routes.some((r) => !(r.caps !== undefined && !r.caps.runnable));
for (const r of monitorRoutes) {
  const item = layout.find((i) => i.instanceId === `route/${spec.controllers[0].controller}/${r.routeId}`);
  assert(item?.hidden === anyRunnable, `monitor-only route '${r.name}' default-hidden when runnable routes exist`);
}
if (monitorRoutes.length === 0) {
  console.log("  – (fixture has no monitor-only routes; rule covered by the synthetic spec below)");
}
assert(layout[healthIdx].hidden === true, "health-history starts hidden");
// Trends (movement charts) are shown by default — diagnostics, but visible.
const trendItems = layout.filter((i) => i.section === "Trends");
if (trendItems.length) assert(trendItems.every((i) => !i.hidden), "trend charts start visible");
const mapItem = layout.find((i) => i.instanceId === "live-map");
assert(mapItem?.hidden === false && mapItem.w === 12, "live map visible at full width on desktop");
// Absorption (the old MAP_ABSORBS rule): on desktop the map already shows
// levels and valve states, so the node cards start hidden; on phone the map
// hides and the node cards become the visible substitute.
const mobileLayout = buildDefaultLayout(spec, WIDGET_DEFS, { mobile: true });
const mobileMap = mobileLayout.find((i) => i.instanceId === "live-map");
assert(mobileMap?.hidden === true, "map starts hidden on phone");
const desktopNodes = layout.filter((i) => i.section === "Status & controls");
assert(desktopNodes.length > 0 && desktopNodes.every((i) => i.hidden),
  "node cards start hidden on desktop (the map absorbs them)");
const mobileNodes = mobileLayout.filter((i) => i.section === "Status & controls");
assert(mobileNodes.length > 0 && mobileNodes.every((i) => !i.hidden),
  "node cards are visible on phone (the map substitute)");

// --- Entitlement-filtered defs drop their instances ----------------------------------
console.log("\nEntitlement filtering:");
const noMap = buildDefaultLayout(spec, WIDGET_DEFS.filter((d) => d.id !== "live-map"));
assert(!noMap.some((i) => i.widgetId === "live-map"), "a def filtered out of the registry emits no instance");
const unentitled = buildDefaultLayout(spec, filterByEntitlement(WIDGET_DEFS, []));
assert(!unentitled.some((i) => i.widgetId === "billing-outstanding" || i.widgetId === "meter-valve"),
  "billing widgets drop out without the tenant_billing capability");
const entitled = buildDefaultLayout(spec, filterByEntitlement(WIDGET_DEFS, ["tenant_billing"]));
assert(idx2(entitled, "billing-outstanding") >= 0 && idx2(entitled, "meter-valve") >= 0,
  "billing widgets emit when the tenant_billing capability is granted");

// --- Device build: cloudOnly defs drop their instances ---------------------------------
console.log("\nDevice build filtering:");
const CLOUD_ONLY = new Set(["flow", "line", "usage-totals", "health-history", "billing-outstanding", "meter-valve"]);
const deviceDefs = filterForBuild(WIDGET_DEFS, true);
const deviceLayout = buildDefaultLayout(spec, deviceDefs);
assert(
  !deviceLayout.some((i) => CLOUD_ONLY.has(i.widgetId)),
  "device layout has no flow/line/usage/health/billing instances",
  deviceLayout.filter((i) => CLOUD_ONLY.has(i.widgetId)).map((i) => i.instanceId).join(","),
);
assert(deviceLayout.some((i) => i.instanceId === "live-map"), "device layout keeps the live map");
assert(deviceLayout.some((i) => i.widgetId === "route-card"), "device layout keeps route cards");
assert(deviceLayout.some((i) => i.widgetId === "tank"), "device layout keeps tank levels");
assert(deviceLayout.some((i) => i.widgetId === "timeline"), "device layout keeps activity timelines");
const cloudLayout = buildDefaultLayout(spec, filterForBuild(WIDGET_DEFS, false));
assert(cloudLayout.length === layout.length, "cloud build filtering is a no-op");

// --- Monitor-only routes, synthetic spec ----------------------------------------------
console.log("\nMonitor-only routes (synthetic):");
const MONITOR_CAPS = { runnable: false } as unknown as RouteCapabilities;
const mkSpec = (caps: (RouteCapabilities | undefined)[]): DashboardSpec => ({
  widgets: [],
  controllers: [{
    controller: "c1", name: "C1",
    routes: caps.map((c, i) => ({ routeId: i, name: `r${i}`, caps: c })),
    actuators: [], channels: [], tunables: [], calibrations: [],
  }],
});
{
  const l = buildDefaultLayout(mkSpec([MONITOR_CAPS, undefined]), WIDGET_DEFS);
  const mon = l.find((i) => i.instanceId === "route/c1/0");
  const run = l.find((i) => i.instanceId === "route/c1/1");
  assert(mon?.hidden === true, "monitor-only route hidden when a runnable route exists");
  assert(run?.hidden === false, "runnable route visible");
}
{
  const l = buildDefaultLayout(mkSpec([MONITOR_CAPS, MONITOR_CAPS]), WIDGET_DEFS);
  assert(l.filter((i) => i.widgetId === "route-card").every((i) => !i.hidden),
    "monitor-only routes force-shown when nothing is runnable (old dashboard's showMonitor rule)");
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
