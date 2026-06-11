/**
 * Browser route-resolution for the automation CRUD picker. Asserts every route
 * resolves to an owning controller + index + a stable route_set_version (the
 * fields the page stamps onto an automation row).
 *
 * Usage: npx tsx test/automation-routes.test.ts
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { parse as parseYaml } from "yaml";
import {
  parseTopology, listAutomatableRoutes, routeSetVersion, topologyToManifestForController,
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

console.log(`\n========================================`);
console.log(`${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
