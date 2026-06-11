/**
 * Browser route-resolution + legacy migration mapping. Asserts that every route
 * resolves to an owning controller + index + a stable route_set_version, and that
 * the in-topology automations map onto collection rows correctly (day mask, time,
 * level threshold seeded from Source Min).
 *
 * Usage: npx tsx test/automation-routes.test.ts
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { parse as parseYaml } from "yaml";
import {
  parseTopology, listAutomatableRoutes, topologyAutomationsToRows, daysToMask, hmToMin,
  routeSetVersion, topologyToManifestForController,
} from "@core";

const DEFAULTS = path.resolve(new URL(".", import.meta.url).pathname, "..", "defaults");
const CONFIG_PATH = path.join(DEFAULTS, "configs/pump-controller.yaml");

let passed = 0, failed = 0;
function assert(c: boolean, name: string, detail?: string) {
  if (c) { console.log(`  ✓ ${name}`); passed++; }
  else { console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`); failed++; }
}

console.log("Automation route resolution\n===========================\n");

const topology = parseTopology(parseYaml(fs.readFileSync(CONFIG_PATH, "utf-8")));

// --- daysToMask / hmToMin units ---
assert(daysToMask(["MON", "WED", "FRI"]) === 0b0010101, "daysToMask MON,WED,FRI = 0b0010101");
assert(daysToMask(["Monday", "tue"]) === 0b0000011, "daysToMask tolerates long/lower tokens");
assert(hmToMin("06:30") === 390, "hmToMin 06:30 = 390");
assert(hmToMin("00:00") === 0 && hmToMin("23:59") === 1439, "hmToMin bounds");

// --- listAutomatableRoutes ---
const routes = listAutomatableRoutes(topology);
assert(routes.length > 0, "lists at least one route");
const c0 = topology.controllers[0].id;
const m0 = topologyToManifestForController(topology, c0);
assert(
  routes.filter((r) => r.controllerId === c0).length === m0.routes.length,
  "controller's route count matches its manifest",
);
assert(
  routes.every((r) => r.routeSetVersion === routeSetVersion(topologyToManifestForController(topology, r.controllerId))),
  "each route carries its controller's route_set_version",
);
// every route is resolvable back to a unique {controller, index}
const keys = new Set(routes.map((r) => `${r.controllerId}#${r.routeIndex}`));
assert(keys.size === routes.length, "every route resolves to a unique controller+index");

// --- topologyAutomationsToRows ---
const rows = topologyAutomationsToRows(topology, "site123");
const autoCount = (topology.automations ?? []).filter((a) => routes.some((r) => r.routeKey === a.route)).length;
assert(rows.length === autoCount, "maps every non-orphan automation to a row", `${rows.length} vs ${autoCount}`);
if (rows.length > 0) {
  assert(rows.every((r) => r.site === "site123"), "rows carry the site id");
  assert(rows.every((r) => r.controller && r.route_index >= 0 && r.route_set_version >= 0), "rows are fully stamped");
  assert(rows.every((r) => r.override_mask === 0), "migrated rows carry no run-param overrides");
  const level = rows.find((r) => r.trigger_type === "level");
  if (level) {
    const src = routes.find((r) => r.routeKey === level.route_key);
    assert(level.level_threshold_pct === src?.sourceMinPct, "migrated level threshold seeded from Source Min");
  }
  const time = rows.find((r) => r.trigger_type === "time");
  if (time) assert(time.time_min >= 0 && time.time_min <= 1439, "migrated time within a day");
}

console.log(`\n========================================`);
console.log(`${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
