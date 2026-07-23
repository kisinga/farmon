/**
 * Widget registry filtering (src/app/widgets/registry.ts): a capability-gated
 * widget is hidden without the capability and shown with it; capability-less
 * widgets always pass. `filterForBuild` drops cloudOnly defs in the device
 * build and composes with the entitlement filter.
 *
 * Usage: npx tsx test/dashboard-registry.test.ts
 */
import { filterByEntitlement, filterForBuild, defsById, type WidgetDef } from "../src/app/widgets/registry";
import { WIDGET_DEFS } from "../src/app/pages/dashboard/widget-defs";

let passed = 0;
let failed = 0;
function assert(condition: boolean, name: string, detail?: string) {
  if (condition) { console.log(`  ✓ ${name}`); passed++; }
  else { console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`); failed++; }
}

console.log("Dashboard widget registry");
console.log("=========================\n");

const DEFS: WidgetDef[] = [
  { id: "tank", title: "Tank level", defaultVisible: true, defaultWidth: 4 },
  { id: "live-map", title: "System map", defaultVisible: true, defaultWidth: 12 },
  { id: "billing-balance", title: "Balance", capability: "tenant_billing", defaultVisible: true, defaultWidth: 6 },
];

{
  const out = filterByEntitlement(DEFS, []);
  assert(out.length === 2, "capability widget excluded with empty capability set", `got ${out.length}`);
  assert(!out.some((d) => d.id === "billing-balance"), "billing-balance hidden without tenant_billing");
  assert(out.some((d) => d.id === "tank") && out.some((d) => d.id === "live-map"), "capability-less widgets always pass");
}
{
  const out = filterByEntitlement(DEFS, ["tenant_billing"]);
  assert(out.length === 3, "capability widget included when capability granted", `got ${out.length}`);
  assert(out.some((d) => d.id === "billing-balance"), "billing-balance shown with tenant_billing");
}
{
  const out = filterByEntitlement(DEFS, ["some_other_capability"]);
  assert(out.length === 2, "unrelated capability does not unlock the widget", `got ${out.length}`);
}
{
  const map = defsById(DEFS);
  assert(map.get("tank")?.defaultWidth === 4, "defsById resolves a def by id");
  assert(map.get("missing") === undefined, "defsById returns undefined for unknown ids");
}

// --- filterForBuild: the device build drops cloudOnly defs ----------------------
console.log("\nBuild filtering:");
const WITH_CLOUD_ONLY: WidgetDef[] = [
  ...DEFS,
  { id: "flow", title: "Flow rate", defaultVisible: true, defaultWidth: 6, cloudOnly: true },
];
{
  const out = filterForBuild(WITH_CLOUD_ONLY, true);
  assert(!out.some((d) => d.id === "flow"), "cloudOnly def hidden on the device build");
  assert(out.length === WITH_CLOUD_ONLY.length - 1, "only cloudOnly defs drop out", `got ${out.length}`);
  assert(out.some((d) => d.id === "tank"), "non-cloudOnly defs stay on device");
}
{
  const out = filterForBuild(WITH_CLOUD_ONLY, false);
  assert(out.length === WITH_CLOUD_ONLY.length, "cloud build keeps every def", `got ${out.length}`);
  assert(out.some((d) => d.id === "flow"), "cloudOnly def visible on the cloud build");
}
{
  // The shell composes both filters — neither must resurrect what the other dropped.
  const out = filterForBuild(filterByEntitlement(WITH_CLOUD_ONLY, []), true);
  assert(!out.some((d) => d.id === "billing-balance"), "composed: entitlement filter still applies");
  assert(!out.some((d) => d.id === "flow"), "composed: build filter still applies");
  assert(out.some((d) => d.id === "tank") && out.some((d) => d.id === "live-map"), "composed: baseline widgets survive both filters");
}

// --- Contract guard: the billing widgets stay entitlement-gated + cloud-only ------
console.log("\nBilling widget contract:");
{
  const outstanding = WIDGET_DEFS.find((d) => d.id === "billing-outstanding");
  const meterValve = WIDGET_DEFS.find((d) => d.id === "meter-valve");
  assert(!!outstanding && !!meterValve, "both billing defs are registered");
  assert(outstanding?.capability === "tenant_billing" && meterValve?.capability === "tenant_billing",
    "billing defs require the tenant_billing capability");
  assert(outstanding?.cloudOnly === true && meterValve?.cloudOnly === true,
    "billing defs are cloud-only (the device build drops them)");
  assert(outstanding?.defaultVisible === true && meterValve?.defaultVisible === true,
    "billing defs are visible by default");
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
