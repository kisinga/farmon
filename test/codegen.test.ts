/**
 * Integration tests: generate from the example manifest and verify
 * the output is structurally correct and internally consistent.
 *
 * Usage: npm test
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { parse as parseYaml } from "yaml";
import { ManifestSchema, type Manifest } from "../src/schema.js";
import { validate } from "../src/validate.js";
import { generateAll, type GeneratedFile } from "../src/generate.js";

// --- Helpers ---

const ROOT = path.resolve(import.meta.dirname, "..");
const EXAMPLE = path.join(ROOT, "examples/pump-controller/system.yaml");

let manifest: Manifest;
let files: GeneratedFile[];
let fileMap: Map<string, string>;

function loadExample(): Manifest {
  const raw = fs.readFileSync(EXAMPLE, "utf-8");
  return ManifestSchema.parse(parseYaml(raw));
}

function getFile(suffix: string): string {
  for (const [key, content] of fileMap) {
    if (key.endsWith(suffix)) return content;
  }
  throw new Error(`No generated file ending with "${suffix}"`);
}

let passed = 0;
let failed = 0;

function assert(condition: boolean, name: string, detail?: string) {
  if (condition) {
    console.log(`  ✓ ${name}`);
    passed++;
  } else {
    console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`);
    failed++;
  }
}

// --- Setup ---

console.log("Codegen Integration Tests");
console.log("=========================\n");

manifest = loadExample();
const validation = validate(manifest);
files = generateAll(manifest);
fileMap = new Map(files.map((f) => [f.relativePath, f.content]));

// --- Test: Manifest validates ---

console.log("Manifest validation:");
assert(validation.ok, "Example manifest passes validation");
assert(validation.errors.length === 0, "No validation errors");

// --- Test: All expected files are generated ---

console.log("\nFile generation:");
const expectedSuffixes = [
  "routes.h",
  "hardware.yaml",
  "sensors.yaml",
  "_substitutions.yaml",
  "pump.yaml",
];
for (const suffix of expectedSuffixes) {
  const found = [...fileMap.keys()].some((k) => k.endsWith(suffix));
  assert(found, `Generates ${suffix}`);
}

// --- Test: routes.h structure ---

console.log("\nroutes.h content:");
const routesH = getFile("routes.h");

assert(routesH.includes("#pragma once"), "Has pragma once");
assert(routesH.includes("struct Route"), "Defines Route struct");
assert(routesH.includes("valve_mask"), "Route has valve_mask field");
assert(
  routesH.includes(`NUM_ROUTES       = ${manifest.routes.length}`),
  `NUM_ROUTES = ${manifest.routes.length}`
);
assert(
  routesH.includes(`NUM_VALVES       = ${manifest.valves.length}`),
  `NUM_VALVES = ${manifest.valves.length}`
);
assert(
  routesH.includes(`NUM_TANKS        = ${manifest.tanks.length}`),
  `NUM_TANKS = ${manifest.tanks.length}`
);
assert(
  routesH.includes(`NUM_FLOW_SENSORS = ${manifest.flow_sensors.length}`),
  `NUM_FLOW_SENSORS = ${manifest.flow_sensors.length}`
);

// Dispatch functions exist
assert(routesH.includes("inline void open_valve"), "Has open_valve dispatch");
assert(routesH.includes("inline void close_valve"), "Has close_valve dispatch");
assert(routesH.includes("inline float get_tank_level"), "Has get_tank_level dispatch");
assert(routesH.includes("inline float get_flow_rate"), "Has get_flow_rate dispatch");

// Every valve has a dispatch case
for (const v of manifest.valves) {
  assert(
    routesH.includes(`id(${v.id}).make_call()`),
    `Valve ${v.id} in dispatch`
  );
}

// Every tank has a dispatch case
for (const t of manifest.tanks) {
  assert(
    routesH.includes(`id(${t.id}_level).state`),
    `Tank ${t.id} in dispatch`
  );
}

// Every route has a table entry
for (const r of manifest.routes) {
  assert(routesH.includes(`"${r.name}"`), `Route "${r.name}" in table`);
}

// --- Test: hardware.yaml structure ---

console.log("\nhardware.yaml content:");
const hw = getFile("hardware.yaml");

assert(hw.includes("pump_relay"), "Has pump relay");
assert(hw.includes("system_state") && hw.includes("!= 2"), "Pump relay guard present");

for (const v of manifest.valves) {
  assert(hw.includes(`id: ${v.id}_open_pin`), `Valve ${v.id} open pin`);
  assert(hw.includes(`id: ${v.id}_close_pin`), `Valve ${v.id} close pin`);
  assert(hw.includes(`id: ${v.id}\n`), `Valve ${v.id} cover`);
  assert(hw.includes("interlock:"), `Valve ${v.id} has interlock`);
}

// --- Test: sensors.yaml structure ---

console.log("\nsensors.yaml content:");
const sensors = getFile("sensors.yaml");

for (const f of manifest.flow_sensors) {
  assert(sensors.includes(`id: ${f.id}`), `Flow sensor ${f.id} defined`);
  assert(sensors.includes(`\${pin_${f.id}}`), `Flow sensor ${f.id} uses correct pin sub`);
}

for (const t of manifest.tanks) {
  assert(sensors.includes(`id: ${t.id}_level`), `Tank ${t.id} level sensor`);
  assert(sensors.includes(`id: ${t.id}_cal_empty`), `Tank ${t.id} cal empty`);
  assert(sensors.includes(`id: ${t.id}_cal_full`), `Tank ${t.id} cal full`);
}

// Generalized watchdog callbacks
assert(sensors.includes("SENSOR_IDX"), "Flow callbacks use SENSOR_IDX pattern");
assert(sensors.includes("TANK_IDX"), "Tank filters use TANK_IDX pattern");
assert(sensors.includes("ROUTES[id(active_route)]"), "Sensors reference route table");

// --- Test: substitutions ---

console.log("\nsubstitutions content:");
const subs = getFile("_substitutions.yaml");

assert(subs.includes(`device_name: ${manifest.device.name}`), "Device name correct");
assert(subs.includes(`pin_pump_relay: ${manifest.pump.pin}`), "Pump pin correct");

for (const v of manifest.valves) {
  assert(subs.includes(`pin_${v.id}_o: ${v.open_pin}`), `Valve ${v.id} open pin sub`);
  assert(subs.includes(`pin_${v.id}_c: ${v.close_pin}`), `Valve ${v.id} close pin sub`);
}

// --- Test: dashboard ---

console.log("\ndashboard content:");
const dash = getFile("pump.yaml");
const dashObj = parseYaml(dash);

assert(dashObj.title === "Water System", "Dashboard title");
assert(Array.isArray(dashObj.views), "Has views array");
assert(dashObj.views.length === 2, "Two views (Overview + Settings)");
assert(dashObj.views[0].title === "Overview", "First view is Overview");
assert(dashObj.views[1].title === "Settings", "Second view is Settings");

// --- Test: Route table correctness ---

console.log("\nRoute table logic:");

// valve_mask bits should match valve indices
const valveIdx = new Map(manifest.valves.map((v, i) => [v.id, i]));
for (const route of manifest.routes) {
  const expectedMask = route.valves.reduce(
    (acc, v) => acc | (1 << valveIdx.get(v)!),
    0
  );
  const maskBin = `0b${expectedMask.toString(2).padStart(manifest.valves.length, "0")}`;
  assert(routesH.includes(maskBin), `Route "${route.name}" valve_mask = ${maskBin}`);
}

// Watchdog strategies
const wdMap: Record<string, string> = {
  flow: "WD_FLOW",
  level_rise: "WD_LEVEL_RISE",
  runtime_only: "WD_RUNTIME",
};
for (const route of manifest.routes) {
  assert(
    routesH.includes(wdMap[route.watchdog]),
    `Route "${route.name}" watchdog = ${wdMap[route.watchdog]}`
  );
}

// --- Test: Cross-file consistency ---

console.log("\nCross-file consistency:");

// Every sensor ID in routes.h dispatch must exist in sensors.yaml
for (const t of manifest.tanks) {
  assert(
    sensors.includes(`id: ${t.id}_level`) && routesH.includes(`id(${t.id}_level)`),
    `Tank ${t.id}: sensors.yaml ↔ routes.h consistent`
  );
}
for (const f of manifest.flow_sensors) {
  assert(
    sensors.includes(`id: ${f.id}`) && routesH.includes(`id(${f.id})`),
    `Flow ${f.id}: sensors.yaml ↔ routes.h consistent`
  );
}

// Every valve ID in routes.h dispatch must exist in hardware.yaml
for (const v of manifest.valves) {
  assert(
    hw.includes(`id: ${v.id}\n`) && routesH.includes(`id(${v.id}).make_call()`),
    `Valve ${v.id}: hardware.yaml ↔ routes.h consistent`
  );
}

// --- Summary ---

console.log(`\n${"=".repeat(40)}`);
console.log(`${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
